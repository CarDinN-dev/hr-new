const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const catalog = require('../prisma/rbac-catalog.json');
const { expandedPermissions, validateCatalog } = require('../prisma/sync-rbac');

const backendSource = path.resolve(__dirname, '../src');
const frontendSource = path.resolve(__dirname, '../../src');
const mandatoryRoles = ['EMPLOYEE', 'LINE_MANAGER', 'MANAGER', 'HR', 'CPO', 'COO', 'ADMIN', 'SUPER_ADMIN'];

function walk(directory, predicate = () => true) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(file, predicate));
    else if (predicate(file)) files.push(file);
  }
  return files;
}

function decoratorName(decorator) {
  const expression = decorator.expression;
  if (ts.isCallExpression(expression)) return ts.isIdentifier(expression.expression) ? expression.expression.text : null;
  return ts.isIdentifier(expression) ? expression.text : null;
}

function decoratorsOf(node) {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

test('catalogue contains only the eight mandatory built-in roles', () => {
  const { roles } = validateCatalog();
  assert.deepEqual([...roles.keys()], mandatoryRoles);
  assert.equal(catalog.roles.find((role) => role.code === 'ADMIN').protection, 'PROTECTED');
  assert.equal(catalog.roles.find((role) => role.code === 'SUPER_ADMIN').protection, 'SUPER_ADMIN');
  for (const role of mandatoryRoles) assert.ok(expandedPermissions(role, roles).size > 0, `${role} must have effective access`);
});

test('role inheritance and business separation match the production matrix', () => {
  const { roles } = validateCatalog();
  const employee = expandedPermissions('EMPLOYEE', roles);
  const lineManager = expandedPermissions('LINE_MANAGER', roles);
  const manager = expandedPermissions('MANAGER', roles);
  const hr = expandedPermissions('HR', roles);
  const cpo = expandedPermissions('CPO', roles);
  const coo = expandedPermissions('COO', roles);
  const admin = expandedPermissions('ADMIN', roles);
  const superAdmin = new Set(catalog.permissions);

  for (const permission of ['employee.self.read', 'leave.self.create', 'announcement.read', 'notification.self.read']) {
    assert.equal(employee.has(permission), true, `EMPLOYEE requires ${permission}`);
  }
  assert.equal(lineManager.has('leave.team.approve_line_manager'), true);
  assert.equal(lineManager.has('leave.management.approve_manager'), false);
  assert.equal(manager.has('leave.management.approve_manager'), true);
  assert.equal(manager.has('leave.team.approve_line_manager'), false);
  assert.equal(hr.has('leave.hr.approve'), true);
  assert.equal(cpo.has('leave.executive.approve_cpo'), true);
  assert.equal(coo.has('leave.executive.approve_coo'), true);

  for (const permission of ['payroll.generate', 'payroll.approve', 'payroll.publish', 'payroll.mark_paid', 'service_request.hr.generate', 'leave.hr.approve']) {
    assert.equal(cpo.has(permission), false, `CPO must not mutate through ${permission}`);
    assert.equal(coo.has(permission), false, `COO must not mutate through ${permission}`);
    assert.equal(admin.has(permission), false, `ADMIN must not mutate through ${permission}`);
  }
  assert.equal(employee.has('payroll.self.read_payslip'), false, 'EMPLOYEE must not access payroll');
  for (const role of [cpo, coo]) assert.equal(role.has('payroll.read'), true, 'CPO and COO require payroll read access');
  for (const permission of [
    'system.read', 'user.read', 'user.manage', 'user.deactivate', 'user.delete_soft', 'role.read', 'role.manage', 'role.assign',
    'permission.read', 'permission.assign', 'session.manage', 'workflow.policy.read', 'workflow.policy.manage',
    'workflow.delegation.read', 'workflow.delegation.manage', 'audit.configure',
  ]) assert.equal(admin.has(permission), false, `ADMIN must not retain System access through ${permission}`);
  for (const permission of ['settings.manage', 'system.configure', 'department.manage', 'audit.read', 'audit.export']) {
    assert.equal(admin.has(permission), true, `ADMIN non-System access changed for ${permission}`);
  }
  assert.equal(admin.has('payroll.read'), false, 'ADMIN must not access payroll');
  for (const permission of catalog.permissions) assert.equal(superAdmin.has(permission), true, `SUPER_ADMIN lacks ${permission}`);
});

test('every permission is assigned and protected permissions are explicit', () => {
  const { roles } = validateCatalog();
  const assigned = new Set();
  for (const role of roles.keys()) {
    const permissions = role === 'SUPER_ADMIN' ? catalog.permissions : expandedPermissions(role, roles);
    for (const permission of permissions) assigned.add(permission);
  }
  assert.deepEqual(catalog.permissions.filter((permission) => !assigned.has(permission)), []);
  const protectedSet = new Set(catalog.protectedPermissions);
  for (const permission of ['role.assign_protected', 'permission.assign_protected', 'leave.override', 'service_request.override', 'payroll.override']) {
    assert.equal(protectedSet.has(permission), true);
  }
});

test('every controller permission is declared in the catalogue', () => {
  const used = new Set();
  for (const file of walk(backendSource, (name) => name.endsWith('.controller.ts'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const decorator of source.matchAll(/@(Permissions|AnyPermission)\(([^)]*)\)/gu)) {
      for (const code of decorator[2].matchAll(/['"]([^'"]+)['"]/gu)) used.add(code[1]);
    }
  }
  const declared = new Set(catalog.permissions);
  assert.deepEqual([...used].filter((permission) => !declared.has(permission)).sort(), []);
});

test('every HTTP endpoint has an explicit public or permission policy', () => {
  const missing = [];
  const httpDecorators = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);
  const policyDecorators = new Set(['Public', 'Permissions', 'AnyPermission']);
  for (const file of walk(backendSource, (name) => name.endsWith('.controller.ts'))) {
    const source = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement)) continue;
      const classPolicies = new Set(decoratorsOf(statement).map(decoratorName).filter(Boolean));
      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        const names = new Set(decoratorsOf(member).map(decoratorName).filter(Boolean));
        if (![...names].some((name) => httpDecorators.has(name))) continue;
        if (![...new Set([...classPolicies, ...names])].some((name) => policyDecorators.has(name))) {
          missing.push(`${path.relative(backendSource, file)}:${member.name.getText(sourceFile)}`);
        }
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('public bypass is restricted to health and authentication entry points', () => {
  const publicUses = [];
  for (const file of walk(backendSource, (name) => name.endsWith('.ts'))) {
    const source = fs.readFileSync(file, 'utf8');
    if (source.includes('@Public()')) publicUses.push(path.relative(backendSource, file).replaceAll('\\', '/'));
  }
  assert.deepEqual(publicUses.sort(), ['health.controller.ts', 'modules/auth/auth.controller.ts']);
  const auth = fs.readFileSync(path.join(backendSource, 'modules/auth/auth.controller.ts'), 'utf8');
  assert.equal((auth.match(/@Public\(\)/gu) ?? []).length, 3);
  assert.doesNotMatch(auth, /register/iu);
});

test('runtime and frontend contain no legacy role gates or undeclared permission checks', () => {
  const forbiddenRoles = /\b(DEPARTMENT_HEAD|HR_OFFICER|HR_MANAGER|PAYROLL_OFFICER|AUDITOR|SYSTEM_ADMIN|HR_ADMIN|LegacyRole|LegacyPermission)\b/u;
  for (const file of [...walk(backendSource, (name) => name.endsWith('.ts')), ...walk(frontendSource, (name) => /\.(ts|tsx)$/u.test(name))]) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), forbiddenRoles, `legacy authorization remains in ${file}`);
  }

  const declared = new Set(catalog.permissions);
  const unknown = new Set();
  for (const file of walk(frontendSource, (name) => /\.(ts|tsx)$/u.test(name))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:hasPermission|hasAnyPermission|hasAllPermissions)\([^)]*?['"]([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)['"]/gu)) {
      if (!declared.has(match[1])) unknown.add(match[1]);
    }
  }
  assert.deepEqual([...unknown].sort(), []);
});

test('dedicated workflow modules are not written through aggregate state synchronization', () => {
  const sync = fs.readFileSync(path.join(frontendSource, 'normalizedSync.ts'), 'utf8');
  for (const forbidden of ['/leave/submit', '/service-requests', '/payroll/runs', '/audit/events', '/system/users', '/notifications', '/approvals/inbox']) {
    assert.equal(sync.includes(forbidden), false, `${forbidden} must use its dedicated query module`);
  }
  const legacyLeave = fs.readFileSync(path.join(backendSource, 'modules/leave/leave-requests.controller.ts'), 'utf8');
  assert.doesNotMatch(legacyLeave, /@(Post|Patch|Delete)\b/u);
});

test('scoped query builders do not encode unrestricted access as an empty OR branch', () => {
  for (const file of walk(backendSource, (name) => name.endsWith('.service.ts'))) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /scopes\.push\([^\n]*:\s*\{\}\s*\)/u, `empty OR branch remains in ${file}`);
  }
  const payroll = fs.readFileSync(path.join(backendSource, 'modules/payroll/payroll.service.ts'), 'utf8');
  const certificates = fs.readFileSync(path.join(backendSource, 'modules/service-requests/service-requests.service.ts'), 'utf8');
  assert.match(payroll, /softDelete:\s*false/u);
  assert.match(certificates, /softDelete:\s*false/u);
});

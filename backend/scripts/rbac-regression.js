const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const catalog = require('../prisma/rbac-catalog.json');
const { expandedPermissions, validateCatalog } = require('../prisma/migrate-rbac');

test('RBAC catalogue is valid and contains the eight default roles', () => {
  const { roles } = validateCatalog();
  assert.deepEqual([...roles.keys()], [
    'EMPLOYEE', 'LINE_MANAGER', 'DEPARTMENT_HEAD', 'HR_OFFICER',
    'HR_MANAGER', 'PAYROLL_OFFICER', 'AUDITOR', 'SYSTEM_ADMIN',
  ]);
  for (const role of catalog.roles) assert.ok(expandedPermissions(role.code, roles).size > 0);
});

test('system administration does not imply confidential HR or payroll access', () => {
  const { roles } = validateCatalog();
  const permissions = expandedPermissions('SYSTEM_ADMIN', roles);
  for (const forbidden of ['employee.hr.read_sensitive', 'payroll.read', 'payroll.read_bank', 'payroll.read_compensation']) {
    assert.equal(permissions.has(forbidden), false, `${forbidden} must remain separated from SYSTEM_ADMIN`);
  }
  assert.equal(permissions.has('role.assign_any'), true);
});

test('auditor and payroll roles do not inherit employee mutation permissions', () => {
  const { roles } = validateCatalog();
  const auditor = expandedPermissions('AUDITOR', roles);
  const payroll = expandedPermissions('PAYROLL_OFFICER', roles);
  for (const permission of ['employee.self.update_basic', 'leave.self.create', 'expense.self.create', 'document.self.manage']) {
    assert.equal(auditor.has(permission), false, `AUDITOR must not receive ${permission}`);
    assert.equal(payroll.has(permission), false, `PAYROLL_OFFICER must not receive ${permission}`);
  }
  assert.equal(auditor.has('session.self.read'), true);
  assert.equal(payroll.has('session.self.revoke'), true);
});

test('legacy role mappings are explicit and preserve no implicit bypass', () => {
  assert.deepEqual(catalog.legacyRoleMap.EMPLOYEE, ['EMPLOYEE']);
  assert.deepEqual(catalog.legacyRoleMap.MANAGER, ['EMPLOYEE', 'LINE_MANAGER']);
  assert.deepEqual(catalog.legacyRoleMap.HR_ADMIN, ['HR_MANAGER', 'PAYROLL_OFFICER', 'AUDITOR']);
  assert.ok(catalog.legacyRoleMap.SUPER_ADMIN.includes('SYSTEM_ADMIN'));
  assert.equal(catalog.legacyRoleMap.SUPER_ADMIN.includes('SUPER_ADMIN'), false);
  assert.deepEqual(catalog.legacyRoleCompatibilityPermissions.HR_ADMIN, [
    'system.configure', 'import.run', 'import.read', 'user.read', 'user.manage',
  ]);
});

test('all catalogue permissions are assigned to at least one default role', () => {
  const { roles } = validateCatalog();
  const assigned = new Set();
  for (const role of roles.keys()) for (const permission of expandedPermissions(role, roles)) assigned.add(permission);
  assert.deepEqual(catalog.permissions.filter((permission) => !assigned.has(permission)), []);
});

test('every controller permission is declared in the catalogue', () => {
  const used = new Set();
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.controller.ts')) {
        const source = fs.readFileSync(file, 'utf8');
        for (const decorator of source.matchAll(/@(Permissions|AnyPermission)\(([^)]*)\)/gu)) {
          for (const code of decorator[2].matchAll(/['"]([^'"]+)['"]/gu)) used.add(code[1]);
        }
      }
    }
  };
  visit(path.resolve(__dirname, '../src'));
  const catalogue = new Set(catalog.permissions);
  assert.deepEqual([...used].filter((permission) => !catalogue.has(permission)), []);
});

test('every controller endpoint has an explicit public or permission policy', () => {
  const missing = [];
  const httpDecorators = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);
  const policyDecorators = new Set(['Public', 'Permissions', 'AnyPermission']);
  const decoratorName = (decorator) => {
    const expression = decorator.expression;
    if (ts.isCallExpression(expression)) return ts.isIdentifier(expression.expression) ? expression.expression.text : null;
    return ts.isIdentifier(expression) ? expression.text : null;
  };
  const decoratorsOf = (node) => ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.controller.ts')) {
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
              missing.push(`${path.relative(path.resolve(__dirname, '../src'), file)}:${member.name.getText(sourceFile)}`);
            }
          }
        }
      }
    }
  };
  visit(path.resolve(__dirname, '../src'));
  assert.deepEqual(missing, []);
});

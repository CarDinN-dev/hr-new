const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(backendRoot, '..');
const catalog = JSON.parse(readFileSync(path.join(backendRoot, 'prisma/rbac-catalog.json'), 'utf8'));
const roleByCode = new Map(catalog.roles.map((role) => [role.code, role]));

function expandedPermissions(roleCode, visiting = new Set()) {
  assert.equal(visiting.has(roleCode), false, `role inheritance cycle at ${roleCode}`);
  const role = roleByCode.get(roleCode);
  assert.ok(role, `missing role ${roleCode}`);
  const next = new Set(visiting).add(roleCode);
  const permissions = new Set(role.permissions);
  for (const parent of role.inherits) {
    for (const permission of expandedPermissions(parent, next)) permissions.add(permission);
  }
  return permissions;
}

const lowerRoles = ['EMPLOYEE', 'LINE_MANAGER', 'MANAGER'];
for (const roleCode of lowerRoles) {
  const attendance = [...expandedPermissions(roleCode)].filter((permission) => permission.startsWith('attendance.'));
  assert.deepEqual(attendance, [], `${roleCode} must not receive attendance access: ${attendance.join(', ')}`);
}

for (const permission of ['attendance.hr.read', 'attendance.hr.manage']) {
  assert.ok(expandedPermissions('HR').has(permission), `HR missing ${permission}`);
}
for (const roleCode of ['CPO', 'COO', 'ADMIN', 'SUPER_ADMIN']) {
  assert.ok(expandedPermissions(roleCode).has('attendance.read_all'), `${roleCode} missing attendance.read_all`);
}

const controller = readFileSync(path.join(backendRoot, 'src/modules/attendance/attendance.controller.ts'), 'utf8');
for (const legacyPermission of [
  'attendance.self.read', 'attendance.self.create', 'attendance.team.read', 'attendance.team.review',
  'attendance.management.read', 'attendance.management.review',
]) {
  assert.equal(controller.includes(legacyPermission), false, `attendance controller still accepts ${legacyPermission}`);
}
for (const requiredPermission of ['attendance.hr.read', 'attendance.hr.manage', 'attendance.read_all']) {
  assert.ok(controller.includes(requiredPermission), `attendance controller missing ${requiredPermission}`);
}

const frontendAuthorization = readFileSync(path.join(repositoryRoot, 'src/authorization.tsx'), 'utf8');
const attendanceRouteLine = frontendAuthorization.split('\n').find((line) => line.trim().startsWith('Attendance:')) || '';
assert.ok(attendanceRouteLine.includes('attendance.hr.read'));
assert.ok(attendanceRouteLine.includes('attendance.read_all'));
assert.equal(/attendance\.(self|team|management)\./.test(attendanceRouteLine), false, 'frontend attendance route exposes lower-role permissions');

const frontendApi = readFileSync(path.join(repositoryRoot, 'src/api.ts'), 'utf8');
const attendanceLoaderLine = frontendApi.split('\n').find((line) => line.includes('"/attendance"')) || '';
assert.ok(attendanceLoaderLine.includes('attendance.hr.read'));
assert.ok(attendanceLoaderLine.includes('attendance.read_all'));
assert.equal(/attendance\.(self|team|management)\./.test(attendanceLoaderLine), false, 'frontend attendance loader exposes lower-role permissions');

const authorizationService = readFileSync(path.join(backendRoot, 'src/modules/authorization/authorization.service.ts'), 'utf8');
const stepUpMethod = authorizationService.match(/requireRecentStepUp\([\s\S]*?\n  \}/)?.[0] || '';
assert.ok(stepUpMethod.includes('reauthenticatedAt'), 'step-up must verify reauthenticatedAt');
assert.equal(stepUpMethod.includes('if (user.isSuperAdmin) return'), false, 'SUPER_ADMIN must not bypass step-up authentication');
assert.ok(authorizationService.includes('collectRolePermissions'), 'role inheritance must be resolved recursively');
assert.ok(authorizationService.includes('Role inheritance cycle detected'), 'recursive role inheritance must reject cycles');

console.log('Production RBAC regression checks passed.');

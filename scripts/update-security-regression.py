from pathlib import Path

path = Path('backend/scripts/security-regression.js')
text = path.read_text()

old = """test('Super Administrators bypass step-up authentication while other roles do not', () => {
  const authorization = new AuthorizationService({});
  assert.doesNotThrow(() => authorization.requireRecentStepUp(user({ isSuperAdmin: true, reauthenticatedAt: new Date(0) })));
  assert.throws(() => authorization.requireRecentStepUp(user({ reauthenticatedAt: new Date(0) })), /Recent authentication is required/);
});"""
new = """test('protected operations require recent step-up authentication for every role, including Super Administrators', () => {
  const authorization = new AuthorizationService({});
  assert.throws(() => authorization.requireRecentStepUp(user({ isSuperAdmin: true, reauthenticatedAt: new Date(0) })), /Recent authentication is required/);
  assert.throws(() => authorization.requireRecentStepUp(user({ reauthenticatedAt: new Date(0) })), /Recent authentication is required/);
  assert.doesNotThrow(() => authorization.requireRecentStepUp(user({ isSuperAdmin: true, reauthenticatedAt: new Date() })));
});"""
if old not in text:
    raise SystemExit('Step-up test fixture was not found')
text = text.replace(old, new, 1)

replacements = [
    (
        "{ role: { code: 'EMPLOYEE', protection: RoleProtection.STANDARD, permissions: [{ permission: { code: 'employee.self.read' } }], inheritedRoles: [] } },",
        "{ role: { id: 'role-employee', code: 'EMPLOYEE', protection: RoleProtection.STANDARD, permissions: [{ permission: { code: 'employee.self.read' } }] } },",
    ),
    (
        "{ role: { code: 'LINE_MANAGER', protection: RoleProtection.STANDARD, permissions: [{ permission: { code: 'employee.team.read' } }], inheritedRoles: [] } },",
        "{ role: { id: 'role-line-manager', code: 'LINE_MANAGER', protection: RoleProtection.STANDARD, permissions: [{ permission: { code: 'employee.team.read' } }] } },",
    ),
    (
        "const service = new AuthorizationService({ user: { findUnique: async (query) => { userQuery = query; return record; } } });",
        "const service = new AuthorizationService({ user: { findUnique: async (query) => { userQuery = query; return record; } }, role: { findMany: async () => record.roles.map(({ role }) => ({ id: role.id, permissions: role.permissions, inheritedRoles: [] })) } });",
    ),
    (
        "record.roles.push({ role: { code: 'SUPER_ADMIN', protection: RoleProtection.SUPER_ADMIN, permissions: [{ permission: { code: 'employee.team.read' } }], inheritedRoles: [] } });",
        "record.roles.push({ role: { id: 'role-super-admin', code: 'SUPER_ADMIN', protection: RoleProtection.SUPER_ADMIN, permissions: [{ permission: { code: 'employee.team.read' } }] } });",
    ),
]
for before, after in replacements:
    if before not in text:
        raise SystemExit(f'Fixture target not found: {before[:60]}')
    text = text.replace(before, after, 1)

old_custom = """    roles: [{ role: {
      code: 'CUSTOM_REPORTER', protection: RoleProtection.STANDARD,
      permissions: [{ permission: { code: 'report.read' } }],
      inheritedRoles: [{ parentRole: { permissions: [{ permission: { code: 'employee.self.read' } }] } }],
    } }],"""
new_custom = """    roles: [{ role: {
      id: 'role-custom-reporter', code: 'CUSTOM_REPORTER', protection: RoleProtection.STANDARD,
      permissions: [{ permission: { code: 'report.read' } }],
    } }],"""
if old_custom not in text:
    raise SystemExit('Custom inheritance assigned-role fixture was not found')
text = text.replace(old_custom, new_custom, 1)

old_custom_service = "const service = new AuthorizationService({ user: { findUnique: async () => record } });"
new_custom_service = """const service = new AuthorizationService({
    user: { findUnique: async () => record },
    role: { findMany: async () => [
      { id: 'role-custom-reporter', permissions: [{ permission: { code: 'report.read' } }], inheritedRoles: [{ parentRoleId: 'role-employee' }] },
      { id: 'role-employee', permissions: [{ permission: { code: 'employee.self.read' } }], inheritedRoles: [] },
    ] },
  });"""
if old_custom_service not in text:
    raise SystemExit('Custom inheritance service fixture was not found')
text = text.replace(old_custom_service, new_custom_service, 1)

path.write_text(text)

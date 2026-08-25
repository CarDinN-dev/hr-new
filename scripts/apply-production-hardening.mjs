import { readFileSync, writeFileSync } from 'node:fs';

function patch(path, transform) {
  const before = readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`No change applied to ${path}`);
  writeFileSync(path, after);
}

function replaceExact(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Patch target not found: ${label}`);
  return source.replace(from, to);
}

patch('backend/src/modules/authorization/authorization.service.ts', (source) => {
  source = replaceExact(source,
`                code: true,
                protection: true,
                permissions: { where: { permission: { isDeprecated: false } }, select: { permission: { select: { code: true } } } },
                inheritedRoles: { select: { parentRole: { select: { permissions: { where: { permission: { isDeprecated: false } }, select: { permission: { select: { code: true } } } } } } } },`,
`                id: true,
                code: true,
                protection: true,
                permissions: { where: { permission: { isDeprecated: false } }, select: { permission: { select: { code: true } } } },`,
    'authorization assigned-role select');

  source = replaceExact(source,
`    if (!user.roles.length) throw new UnauthorizedException('User has no active role assignment');
    return user;`,
`    if (!user.roles.length) throw new UnauthorizedException('User has no active role assignment');
    const authorizationRoles = await this.prisma.role.findMany({
      where: { isActive: true },
      select: {
        id: true,
        permissions: { where: { permission: { isDeprecated: false } }, select: { permission: { select: { code: true } } } },
        inheritedRoles: { select: { parentRoleId: true } },
      },
    });
    return { ...user, authorizationRoles };`,
    'authorization role graph load');

  source = replaceExact(source,
`    const rolePermissions = new Set<string>();
    const roles = new Set<string>();
    const isSuperAdmin = user.roles.some((assignment) => assignment.role.code === 'SUPER_ADMIN' && assignment.role.protection === RoleProtection.SUPER_ADMIN);
    for (const assignment of user.roles) {
      roles.add(assignment.role.code);
      for (const link of assignment.role.permissions) rolePermissions.add(link.permission.code);
      for (const inherited of assignment.role.inheritedRoles) for (const link of inherited.parentRole.permissions) rolePermissions.add(link.permission.code);
    }`,
`    const rolePermissions = new Set<string>();
    const roles = new Set<string>();
    const roleById = new Map(user.authorizationRoles.map((role) => [role.id, role]));
    const collectRolePermissions = (roleId: string, stack = new Set<string>()) => {
      if (stack.has(roleId)) throw new UnauthorizedException('Role inheritance cycle detected');
      const role = roleById.get(roleId);
      if (!role) return;
      const next = new Set(stack).add(roleId);
      for (const link of role.permissions) rolePermissions.add(link.permission.code);
      for (const inherited of role.inheritedRoles) collectRolePermissions(inherited.parentRoleId, next);
    };
    const isSuperAdmin = user.roles.some((assignment) => assignment.role.code === 'SUPER_ADMIN' && assignment.role.protection === RoleProtection.SUPER_ADMIN);
    for (const assignment of user.roles) {
      roles.add(assignment.role.code);
      collectRolePermissions(assignment.role.id);
    }`,
    'recursive role inheritance');

  source = replaceExact(source,
`  requireRecentStepUp(user: RequestUser, windowMs = 10 * 60 * 1000) {
    if (user.isSuperAdmin) return;
    if (!user.reauthenticatedAt || Date.now() - user.reauthenticatedAt.getTime() > windowMs) {`,
`  requireRecentStepUp(user: RequestUser, windowMs = 10 * 60 * 1000) {
    if (!user.reauthenticatedAt || Date.now() - user.reauthenticatedAt.getTime() > windowMs) {`,
    'super-admin step-up bypass');

  return source;
});

patch('src/api.ts', (source) => replaceExact(source,
`    listWhen<Record<string, unknown>>(hasAnyPermission(session, "attendance.self.read", "attendance.team.read", "attendance.management.read", "attendance.hr.read", "attendance.read_all"), "/attendance"),`,
`    listWhen<Record<string, unknown>>(hasAnyPermission(session, "attendance.hr.read", "attendance.hr.manage", "attendance.audit.read", "attendance.read_all"), "/attendance"),`,
  'frontend attendance loader'));

patch('backend/src/modules/attendance/attendance.service.ts', (source) => {
  source = source.replace(
`    if (!this.authorization.hasAny(user, ['attendance.team.read', 'attendance.management.read', 'attendance.hr.read', 'attendance.audit.read', 'attendance.read_all'])) {
      throw new ForbiddenException('Only managers and HR can access attendance reports');
    }`,
`    if (!this.authorization.hasAny(user, ['attendance.hr.read', 'attendance.hr.manage', 'attendance.audit.read', 'attendance.read_all'])) {
      throw new ForbiddenException('Only HR and authorized auditors can access attendance reports');
    }`);

  source = source.replace(
/  private async accessWhere\(user: RequestUser\): Promise<Prisma\.AttendanceWhereInput> \{[\s\S]*?\n  \}\n\n  private async resolveSelfOrHrEmployee/,
`  private async accessWhere(user: RequestUser): Promise<Prisma.AttendanceWhereInput> {
    const scopes: Prisma.AttendanceWhereInput[] = [];
    for (const permission of ['attendance.hr.read', 'attendance.hr.manage', 'attendance.audit.read', 'attendance.read_all'] as const) {
      const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_EMPLOYEES);
      if (rule.unrestricted) {
        if (!rule.excludeIds.length) return {};
        scopes.push({ employeeId: { notIn: rule.excludeIds } });
      } else if (rule.includeIds.length) scopes.push({ employeeId: { in: rule.includeIds } });
    }
    return scopes.length ? { OR: scopes } : { employeeId: '__no_employee_scope__' };
  }

  private async resolveSelfOrHrEmployee`);

  source = source.replace(
/  private async resolveSelfOrHrEmployee\(employeeId: string \| undefined, user: RequestUser\) \{[\s\S]*?\n  \}\n\n  private async ensureEmployee/,
`  private async resolveSelfOrHrEmployee(employeeId: string | undefined, user: RequestUser) {
    const targetEmployeeId = employeeId ?? user.employeeId;
    if (!targetEmployeeId) throw new NotFoundException('No employee profile is linked to this user');
    await this.authorization.assertEmployeeScope(user, targetEmployeeId, { all: 'attendance.hr.manage' });
    await this.ensureEmployee(targetEmployeeId);
    return targetEmployeeId;
  }

  private async ensureEmployee`);

  return source;
});

console.log('Production hardening patches applied.');

import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AccessScopeType, PermissionOverrideEffect, Prisma, RoleProtection } from '@prisma/client';
import { RequestUser } from '../../common/types/request-user.type';
import { PrismaService } from '../../prisma/prisma.service';

const MAX_MANAGEMENT_DEPTH = 32;

const activeAssignmentWhere = (now: Date): Prisma.UserRoleWhereInput => ({
  revokedAt: null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  role: { isActive: true },
});

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async loadUserContext(userId: string) {
    const now = new Date();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        isActive: true,
        deletedAt: true,
        authorizationVersion: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            deletedAt: true,
            managedDepartments: { where: { deletedAt: null }, select: { id: true } },
          },
        },
        roles: {
          where: activeAssignmentWhere(now),
          select: {
            role: {
              select: {
                code: true,
                protection: true,
                permissions: { where: { permission: { isDeprecated: false } }, select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
        permissionOverrides: {
          where: {
            revokedAt: null,
            startsAt: { lte: now },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            permission: { isDeprecated: false },
          },
          select: {
            effect: true,
            scopeType: true,
            scopeIds: true,
            permission: { select: { code: true } },
          },
        },
      },
    });
    if (!user || !user.isActive || user.deletedAt || user.employee?.deletedAt) {
      throw new UnauthorizedException('User account is inactive');
    }
    if (!user.roles.length) throw new UnauthorizedException('User has no active role assignment');
    return user;
  }

  toRequestUser(
    user: Awaited<ReturnType<AuthorizationService['loadUserContext']>>,
    session: { id: string; csrfToken: string; provider: string; reauthenticatedAt?: Date; ipHash?: string | null },
  ): RequestUser {
    const rolePermissions = new Set<string>();
    const roles = new Set<string>();
    const isSuperAdmin = user.roles.some((assignment) => assignment.role.code === 'SUPER_ADMIN' && assignment.role.protection === RoleProtection.SUPER_ADMIN);
    for (const assignment of user.roles) {
      roles.add(assignment.role.code);
      for (const link of assignment.role.permissions) rolePermissions.add(link.permission.code);
    }
    const permissionOverrides = user.permissionOverrides.map((override) => ({
      permission: override.permission.code,
      effect: override.effect,
      scopeType: override.scopeType,
      scopeIds: override.scopeIds,
    }));
    const permissions = new Set(rolePermissions);
    for (const override of permissionOverrides) if (override.effect === PermissionOverrideEffect.GRANT) permissions.add(override.permission);
    if (!isSuperAdmin) for (const override of permissionOverrides) {
      if (override.effect === PermissionOverrideEffect.DENY && override.scopeType === AccessScopeType.ALL_SYSTEM && override.scopeIds.length === 0) permissions.delete(override.permission);
    }
    const displayName = user.employee
      ? `${user.employee.firstName} ${user.employee.lastName}`.trim()
      : user.email;
    return {
      id: user.id,
      email: user.email,
      displayName,
      roles: [...roles].sort(),
      permissions: [...permissions].sort(),
      rolePermissions: [...rolePermissions].sort(),
      permissionOverrides,
      isSuperAdmin,
      sessionId: session.id,
      authProvider: session.provider,
      authorizationVersion: user.authorizationVersion,
      csrfToken: session.csrfToken,
      employeeId: user.employee?.id ?? null,
      departmentScopeIds: user.employee?.managedDepartments.map((department) => department.id) ?? [],
      reauthenticatedAt: session.reauthenticatedAt,
      ipHash: session.ipHash,
    };
  }

  has(user: RequestUser, permission: string) {
    return user.permissions.includes(permission);
  }

  hasAny(user: RequestUser, permissions: readonly string[]) {
    return permissions.some((permission) => this.has(user, permission));
  }

  hasAll(user: RequestUser, permissions: readonly string[]) {
    return permissions.every((permission) => this.has(user, permission));
  }

  require(user: RequestUser, permission: string) {
    if (!this.has(user, permission)) throw new ForbiddenException('Insufficient permission');
  }

  requireAny(user: RequestUser, permissions: readonly string[]) {
    if (!this.hasAny(user, permissions)) throw new ForbiddenException('Insufficient permission');
  }

  requireRecentStepUp(user: RequestUser, windowMs = 10 * 60 * 1000) {
    if (user.isSuperAdmin) return;
    if (!user.reauthenticatedAt || Date.now() - user.reauthenticatedAt.getTime() > windowMs) {
      throw new ForbiddenException('Recent authentication is required');
    }
  }

  permissionAllowedForScope(
    user: RequestUser,
    permission: string,
    scopeType: AccessScopeType,
    scopeId?: string | null,
  ) {
    if (user.isSuperAdmin) return user.rolePermissions.includes(permission);
    const overrides = user.permissionOverrides.filter((override) => override.permission === permission);
    const applicable = overrides.filter((override) => this.overrideApplies(override.scopeType, override.scopeIds, scopeType, scopeId));
    if (applicable.some((override) => override.effect === PermissionOverrideEffect.DENY)) return false;
    if (applicable.some((override) => override.effect === PermissionOverrideEffect.GRANT)) return true;
    return user.rolePermissions.includes(permission);
  }

  scopeRule(user: RequestUser, permission: string, scopeType: AccessScopeType) {
    if (user.isSuperAdmin) return { unrestricted: user.rolePermissions.includes(permission), includeIds: [] as string[], excludeIds: [] as string[] };
    const relevant = user.permissionOverrides.filter((override) => override.permission === permission && (
      override.scopeType === AccessScopeType.ALL_SYSTEM
      || override.scopeType === scopeType
      || (override.scopeType === AccessScopeType.ALL_EMPLOYEES && scopeType !== AccessScopeType.ALL_SYSTEM)
    ));
    const deniedGlobally = relevant.some((override) => override.effect === PermissionOverrideEffect.DENY && !override.scopeIds.length);
    const grantedGlobally = relevant.some((override) => override.effect === PermissionOverrideEffect.GRANT && !override.scopeIds.length);
    const unrestricted = !deniedGlobally && (user.rolePermissions.includes(permission) || grantedGlobally);
    const includeIds = new Set<string>();
    const excludeIds = new Set<string>();
    for (const override of relevant) {
      if (override.effect === PermissionOverrideEffect.DENY) {
        for (const id of override.scopeIds) excludeIds.add(id);
      } else for (const id of override.scopeIds) includeIds.add(id);
    }
    for (const id of excludeIds) includeIds.delete(id);
    return { unrestricted, includeIds: [...includeIds], excludeIds: [...excludeIds] };
  }

  async assertEmployeeScope(
    user: RequestUser,
    employeeId: string,
    scopes: { self?: string; team?: string; tree?: string; department?: string; all?: string },
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true, managerId: true, departmentId: true },
    });
    if (!employee) throw new NotFoundException('Record not found');
    if (scopes.all && this.permissionAllowedForScope(user, scopes.all, AccessScopeType.ALL_EMPLOYEES, employeeId)) return;
    if (scopes.self && employeeId === user.employeeId && this.permissionAllowedForScope(user, scopes.self, AccessScopeType.SELF, employeeId)) return;
    if (scopes.team && employee.managerId === user.employeeId && this.permissionAllowedForScope(user, scopes.team, AccessScopeType.DIRECT_REPORTS, employeeId)) return;
    if (scopes.department && employee.departmentId && user.departmentScopeIds.includes(employee.departmentId)
      && this.permissionAllowedForScope(user, scopes.department, AccessScopeType.MANAGEMENT_TREE, employeeId)) return;
    if (scopes.tree && user.employeeId && await this.isInManagementTree(user.employeeId, employeeId)
      && this.permissionAllowedForScope(user, scopes.tree, AccessScopeType.MANAGEMENT_TREE, employeeId)) return;
    throw new NotFoundException('Record not found');
  }

  async isInManagementTree(managerEmployeeId: string, employeeId: string) {
    if (managerEmployeeId === employeeId) return false;
    const visited = new Set<string>([employeeId]);
    let currentId: string | null = employeeId;
    for (let depth = 0; depth < MAX_MANAGEMENT_DEPTH; depth += 1) {
      const current: { managerId: string | null } | null = await this.prisma.employee.findFirst({
        where: { id: currentId, deletedAt: null },
        select: { managerId: true },
      });
      if (!current?.managerId) return false;
      if (current.managerId === managerEmployeeId) return true;
      if (visited.has(current.managerId)) return false;
      visited.add(current.managerId);
      currentId = current.managerId;
    }
    return false;
  }

  async managementTreeEmployeeIds(managerEmployeeId: string) {
    const result: string[] = [];
    const visited = new Set<string>([managerEmployeeId]);
    let frontier = [managerEmployeeId];
    for (let depth = 0; depth < MAX_MANAGEMENT_DEPTH && frontier.length; depth += 1) {
      const rows = await this.prisma.employee.findMany({
        where: { managerId: { in: frontier }, deletedAt: null },
        select: { id: true },
      });
      frontier = [];
      for (const row of rows) {
        if (visited.has(row.id)) continue;
        visited.add(row.id);
        result.push(row.id);
        frontier.push(row.id);
      }
    }
    return result;
  }

  async assertNoManagerCycle(employeeId: string, proposedManagerId: string | null | undefined) {
    if (!proposedManagerId) return;
    if (employeeId === proposedManagerId || await this.isInManagementTree(employeeId, proposedManagerId)) {
      throw new ForbiddenException('Reporting manager would create a cycle');
    }
  }

  private overrideApplies(overrideScope: AccessScopeType, ids: string[], requestedScope: AccessScopeType, scopeId?: string | null) {
    if (overrideScope === AccessScopeType.ALL_SYSTEM) return true;
    if (overrideScope !== requestedScope && !(overrideScope === AccessScopeType.ALL_EMPLOYEES && requestedScope !== AccessScopeType.ALL_SYSTEM)) return false;
    return ids.length === 0 || (!!scopeId && ids.includes(scopeId));
  }
}

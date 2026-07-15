import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/types/request-user.type';
import { PrismaService } from '../../prisma/prisma.service';

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
                permissions: { select: { permission: { select: { code: true } } } },
              },
            },
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
    session: { id: string; csrfToken: string },
  ): RequestUser {
    const permissions = new Set<string>();
    const roles = new Set<string>();
    for (const assignment of user.roles) {
      roles.add(assignment.role.code);
      for (const link of assignment.role.permissions) permissions.add(link.permission.code);
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
      sessionId: session.id,
      authorizationVersion: user.authorizationVersion,
      csrfToken: session.csrfToken,
      employeeId: user.employee?.id ?? null,
      departmentScopeIds: user.employee?.managedDepartments.map((department) => department.id) ?? [],
    };
  }

  has(user: RequestUser, permission: string) {
    return user.permissions.includes(permission);
  }

  hasAny(user: RequestUser, permissions: readonly string[]) {
    return permissions.some((permission) => this.has(user, permission));
  }

  require(user: RequestUser, permission: string) {
    if (!this.has(user, permission)) throw new ForbiddenException('Insufficient permission');
  }

  requireAny(user: RequestUser, permissions: readonly string[]) {
    if (!this.hasAny(user, permissions)) throw new ForbiddenException('Insufficient permission');
  }

  async assertEmployeeScope(
    user: RequestUser,
    employeeId: string,
    scopes: { self?: string; team?: string; department?: string; all?: string },
  ) {
    if (scopes.all && this.has(user, scopes.all)) return;
    if (scopes.self && this.has(user, scopes.self) && employeeId === user.employeeId) return;
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { managerId: true, departmentId: true },
    });
    if (!employee) throw new ForbiddenException('Employee is outside the permitted scope');
    if (scopes.team && this.has(user, scopes.team) && employee.managerId === user.employeeId) return;
    if (
      scopes.department
      && this.has(user, scopes.department)
      && employee.departmentId
      && user.departmentScopeIds.includes(employee.departmentId)
    ) return;
    throw new ForbiddenException('Employee is outside the permitted scope');
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { RequestUser } from '../../common/types/request-user.type';
import { paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AssignUserRolesDto, ChangeUserStatusDto, CreateRoleDto, QuerySystemSessionsDto, QuerySystemUsersDto,
  ReplaceRolePermissionsDto, RevokeSystemSessionDto, SystemMutationDto, UpdateRoleDto,
} from './dto/system.dto';

const activeAssignmentWhere = (now: Date): Prisma.UserRoleWhereInput => ({
  revokedAt: null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  role: { isActive: true },
});

@Injectable()
export class SystemService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(query: QuerySystemUsersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      isActive: query.isActive,
      roles: query.roleId ? { some: { roleId: query.roleId, ...activeAssignmentWhere(new Date()) } } : undefined,
      OR: query.search ? [
        { email: { contains: query.search, mode: 'insensitive' } },
        { employee: { firstName: { contains: query.search, mode: 'insensitive' } } },
        { employee: { lastName: { contains: query.search, mode: 'insensitive' } } },
      ] : undefined,
    };
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true, email: true, isActive: true, authorizationVersion: true, createdAt: true, updatedAt: true,
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
          roles: {
            where: activeAssignmentWhere(new Date()),
            select: { id: true, assignedAt: true, expiresAt: true, role: { select: { id: true, code: true, displayName: true, version: true } } },
          },
        },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async effectivePermissions(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true, email: true, authorizationVersion: true,
        roles: {
          where: activeAssignmentWhere(new Date()),
          select: { role: { select: { id: true, code: true, displayName: true, permissions: { select: { permission: true } } } } },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const permissions = new Map<string, { id: string; code: string; displayName: string; category: string }>();
    for (const assignment of user.roles) for (const link of assignment.role.permissions) permissions.set(link.permission.code, link.permission);
    return {
      id: user.id,
      authorizationVersion: user.authorizationVersion,
      roles: user.roles.map((assignment) => ({ id: assignment.role.id, code: assignment.role.code, displayName: assignment.role.displayName })),
      permissions: [...permissions.values()].sort((a, b) => a.code.localeCompare(b.code)),
    };
  }

  changeUserStatus(targetId: string, dto: ChangeUserStatusDto, actor: RequestUser) {
    if (targetId === actor.id) throw new ForbiddenException('Self account-status changes are not permitted');
    return this.serializable(async (tx) => {
      const target = await tx.user.findFirst({ where: { id: targetId, deletedAt: null }, select: { id: true, isActive: true, authorizationVersion: true } });
      if (!target) throw new NotFoundException('User not found');
      if (target.authorizationVersion !== dto.expectedAuthorizationVersion) throw new ConflictException('User authorization changed; refresh and retry');
      if (target.isActive && !dto.isActive) await this.assertNotFinalSystemAdmin(targetId, tx);
      const updated = await tx.user.updateMany({
        where: { id: targetId, authorizationVersion: dto.expectedAuthorizationVersion },
        data: { isActive: dto.isActive, authorizationVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('User authorization changed; refresh and retry');
      await tx.authSession.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit(tx, actor, AuditAction.UPDATE, 'User', targetId, `Account ${dto.isActive ? 'enabled' : 'disabled'}: ${dto.reason}`);
      return tx.user.findUniqueOrThrow({ where: { id: targetId }, select: { id: true, email: true, isActive: true, authorizationVersion: true } });
    });
  }

  assignRoles(targetId: string, dto: AssignUserRolesDto, actor: RequestUser) {
    if (targetId === actor.id) throw new ForbiddenException('Self-role assignment is not permitted');
    return this.serializable(async (tx) => {
      const target = await tx.user.findFirst({ where: { id: targetId, deletedAt: null }, select: { id: true, authorizationVersion: true } });
      if (!target) throw new NotFoundException('User not found');
      if (target.authorizationVersion !== dto.expectedAuthorizationVersion) throw new ConflictException('User authorization changed; refresh and retry');
      const roles = await tx.role.findMany({ where: { id: { in: dto.roleIds }, isActive: true }, select: { id: true, code: true } });
      if (roles.length !== new Set(dto.roleIds).size) throw new BadRequestException('One or more roles do not exist or are inactive');
      const current = await tx.userRole.findMany({ where: { userId: targetId, revokedAt: null }, select: { roleId: true, role: { select: { code: true } } } });
      const desired = new Set(dto.roleIds);
      if (current.some((assignment) => assignment.role.code === 'SYSTEM_ADMIN' && !desired.has(assignment.roleId))) {
        await this.assertNotFinalSystemAdmin(targetId, tx);
      }
      const now = new Date();
      await tx.userRole.updateMany({ where: { userId: targetId, revokedAt: null, roleId: { notIn: dto.roleIds } }, data: { revokedAt: now, reason: dto.reason } });
      for (const role of roles) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: targetId, roleId: role.id } },
          create: { id: randomUUID(), userId: targetId, roleId: role.id, assignedById: actor.id, reason: dto.reason },
          update: { revokedAt: null, expiresAt: null, assignedById: actor.id, assignedAt: now, reason: dto.reason },
        });
      }
      await this.invalidateUser(tx, targetId, dto.expectedAuthorizationVersion);
      await this.audit(tx, actor, AuditAction.UPDATE, 'UserRole', targetId, `Role assignments replaced: ${dto.reason}`);
      return this.effectivePermissionsWithClient(tx, targetId);
    });
  }

  listRoles() {
    return this.prisma.role.findMany({
      select: {
        id: true, code: true, displayName: true, description: true, isBuiltIn: true, isActive: true, version: true, createdAt: true, updatedAt: true,
        permissions: { select: { permission: true } }, _count: { select: { users: true } },
      },
      orderBy: [{ isBuiltIn: 'desc' }, { code: 'asc' }],
    });
  }

  createRole(dto: CreateRoleDto, actor: RequestUser) {
    return this.serializable(async (tx) => {
      const permissions = await this.requirePermissions(tx, dto.permissionIds ?? []);
      const role = await tx.role.create({
        data: {
          id: randomUUID(), code: dto.code, displayName: dto.displayName, description: dto.description, createdById: actor.id,
          permissions: { create: permissions.map((permission) => ({ permissionId: permission.id, assignedById: actor.id })) },
        },
        include: { permissions: { include: { permission: true } } },
      });
      await this.audit(tx, actor, AuditAction.CREATE, 'Role', role.id, `Custom role created: ${dto.reason}`);
      return role;
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Role code already exists');
      throw error;
    });
  }

  updateRole(id: string, dto: UpdateRoleDto, actor: RequestUser) {
    return this.serializable(async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, select: { id: true, code: true, version: true, isBuiltIn: true } });
      if (!role) throw new NotFoundException('Role not found');
      if (role.isBuiltIn) throw new BadRequestException('Built-in roles are managed by the RBAC catalogue');
      if (role.version !== dto.expectedVersion) throw new ConflictException('Role changed; refresh and retry');
      if (role.code === 'SYSTEM_ADMIN' && dto.isActive === false) throw new BadRequestException('SYSTEM_ADMIN cannot be deactivated');
      const updated = await tx.role.updateMany({
        where: { id, version: dto.expectedVersion },
        data: { displayName: dto.displayName, description: dto.description, isActive: dto.isActive, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('Role changed; refresh and retry');
      await this.invalidateRoleUsers(tx, id);
      await this.audit(tx, actor, AuditAction.UPDATE, 'Role', id, `Role updated: ${dto.reason}`);
      return tx.role.findUniqueOrThrow({ where: { id } });
    });
  }

  replaceRolePermissions(id: string, dto: ReplaceRolePermissionsDto, actor: RequestUser) {
    return this.serializable(async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, select: { id: true, version: true, isBuiltIn: true, users: { where: activeAssignmentWhere(new Date()), select: { userId: true } } } });
      if (!role) throw new NotFoundException('Role not found');
      if (role.isBuiltIn) throw new BadRequestException('Built-in roles are managed by the RBAC catalogue');
      if (role.version !== dto.expectedVersion) throw new ConflictException('Role changed; refresh and retry');
      const permissions = await this.requirePermissions(tx, dto.permissionIds);
      if (role.users.some((assignment) => assignment.userId === actor.id)) {
        const actorPermissions = new Set(actor.permissions);
        const escalation = permissions.find((permission) => !actorPermissions.has(permission.code));
        if (escalation) throw new ForbiddenException('Cannot add permissions to a role assigned to yourself');
      }
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: id, permissionId: permission.id, assignedById: actor.id })) });
      await tx.role.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.invalidateRoleUsers(tx, id);
      await this.audit(tx, actor, AuditAction.UPDATE, 'RolePermission', id, `Role permissions replaced: ${dto.reason}`);
      return tx.role.findUniqueOrThrow({ where: { id }, include: { permissions: { include: { permission: true } } } });
    });
  }

  deleteRole(id: string, dto: SystemMutationDto, actor: RequestUser) {
    return this.serializable(async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, select: { id: true, isBuiltIn: true, version: true, users: { select: { id: true }, take: 1 } } });
      if (!role) throw new NotFoundException('Role not found');
      if (role.version !== dto.expectedVersion) throw new ConflictException('Role changed; refresh and retry');
      if (role.isBuiltIn) throw new BadRequestException('Built-in roles cannot be deleted');
      if (role.users.length) throw new BadRequestException('Roles with assignment history cannot be deleted; deactivate the role instead');
      await tx.role.delete({ where: { id } });
      await this.audit(tx, actor, AuditAction.DELETE, 'Role', id, `Custom role deleted: ${dto.reason}`);
      return { deleted: true };
    });
  }

  listPermissions() {
    return this.prisma.permission.findMany({ select: { id: true, code: true, displayName: true, description: true, category: true }, orderBy: [{ category: 'asc' }, { code: 'asc' }] });
  }

  async listSessions(query: QuerySystemSessionsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const now = new Date();
    const where: Prisma.AuthSessionWhereInput = {
      userId: query.userId,
      ...(query.active === true ? { revokedAt: null, expiresAt: { gt: now } } : {}),
      ...(query.active === false ? { OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }] } : {}),
      user: query.search ? { email: { contains: query.search, mode: 'insensitive' } } : undefined,
    };
    const [data, total] = await Promise.all([
      this.prisma.authSession.findMany({
        where,
        select: { id: true, provider: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true, authorizationVersion: true, user: { select: { id: true, email: true, isActive: true } } },
        orderBy: { lastSeenAt: 'desc' }, skip: (page - 1) * limit, take: limit,
      }),
      this.prisma.authSession.count({ where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  revokeSession(id: string, dto: RevokeSystemSessionDto, actor: RequestUser) {
    return this.serializable(async (tx) => {
      const session = await tx.authSession.findUnique({ where: { id }, select: { id: true, userId: true, revokedAt: true } });
      if (!session) throw new NotFoundException('Session not found');
      if (!session.revokedAt) await tx.authSession.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit(tx, actor, AuditAction.LOGOUT, 'AuthSession', id, `Administrative session revocation: ${dto.reason}`);
      return { revoked: true };
    });
  }

  private async requirePermissions(tx: Prisma.TransactionClient, permissionIds: string[]) {
    const permissions = await tx.permission.findMany({ where: { id: { in: permissionIds } }, select: { id: true, code: true } });
    if (permissions.length !== new Set(permissionIds).size) throw new BadRequestException('One or more permissions do not exist');
    return permissions;
  }

  private async assertNotFinalSystemAdmin(targetUserId: string, tx: Prisma.TransactionClient) {
    const now = new Date();
    const remaining = await tx.userRole.count({
      where: { userId: { not: targetUserId }, ...activeAssignmentWhere(now), user: { isActive: true, deletedAt: null }, role: { code: 'SYSTEM_ADMIN', isActive: true } },
    });
    if (remaining < 1) throw new BadRequestException('Cannot remove or disable the final active system administrator');
  }

  private async invalidateUser(tx: Prisma.TransactionClient, userId: string, expectedVersion: number) {
    const updated = await tx.user.updateMany({ where: { id: userId, authorizationVersion: expectedVersion }, data: { authorizationVersion: { increment: 1 } } });
    if (updated.count !== 1) throw new ConflictException('User authorization changed; refresh and retry');
    await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async invalidateRoleUsers(tx: Prisma.TransactionClient, roleId: string) {
    const assignments = await tx.userRole.findMany({ where: { roleId, ...activeAssignmentWhere(new Date()) }, select: { userId: true } });
    const userIds = [...new Set(assignments.map((assignment) => assignment.userId))];
    if (!userIds.length) return;
    await tx.user.updateMany({ where: { id: { in: userIds } }, data: { authorizationVersion: { increment: 1 } } });
    await tx.authSession.updateMany({ where: { userId: { in: userIds }, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async effectivePermissionsWithClient(tx: Prisma.TransactionClient, userId: string) {
    const roles = await tx.userRole.findMany({
      where: { userId, ...activeAssignmentWhere(new Date()) },
      select: { role: { select: { id: true, code: true, displayName: true, permissions: { select: { permission: true } } } } },
    });
    const permissions = new Map<string, unknown>();
    for (const assignment of roles) for (const link of assignment.role.permissions) permissions.set(link.permission.code, link.permission);
    return { roles: roles.map((assignment) => ({ id: assignment.role.id, code: assignment.role.code, displayName: assignment.role.displayName })), permissions: [...permissions.values()] };
  }

  private audit(tx: Prisma.TransactionClient, actor: RequestUser, action: AuditAction, entityType: string, entityId: string, summary: string) {
    return tx.auditEvent.create({ data: { actorUserId: actor.id, requestId: actor.requestId, action, entityType, entityId, summary } });
  }

  private async serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error; }
    }
    throw new ConflictException('Authorization changed in another request. Refresh and retry.');
  }
}

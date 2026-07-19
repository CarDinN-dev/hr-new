import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccessScopeType, ApproverMode, AuditAction, AuditOutcome, LeaveApprovalStage, PermissionOverrideEffect, Prisma,
  RoleProtection, WorkflowType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { hasActiveSuperAdminRole } from '../../common/authorization';
import { RequestUser } from '../../common/types/request-user.type';
import { paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import {
  AssignUserRolesDto, ChangeUserStatusDto, CreatePermissionOverrideDto, CreateRoleDto, CreateSystemUserDto,
  CreateWorkflowDelegationDto, QuerySystemSessionsDto, QuerySystemUsersDto,
  ReplaceRolePermissionsDto, RevokePermissionOverrideDto, RevokeSystemSessionDto,
  RevokeWorkflowDelegationDto, SystemMutationDto, UpdateRoleDto, UpdateSystemUserDto, UpdateWorkflowPolicyDto,
} from './dto/system.dto';
import { MicrosoftDirectoryProvisioningService } from './microsoft-directory-provisioning.service';

const activeAssignmentWhere = (now: Date): Prisma.UserRoleWhereInput => ({
  revokedAt: null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  role: { isActive: true },
});

@Injectable()
export class SystemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly config: ConfigService,
    private readonly microsoftDirectory: MicrosoftDirectoryProvisioningService,
  ) {}

  async createUser(dto: CreateSystemUserDto, actor: RequestUser) {
    this.assertSystemScope(actor, 'user.manage');
    if (dto.localLoginEnabled && !dto.password) throw new BadRequestException('A password is required when local login is enabled');
    if (dto.password && Buffer.byteLength(dto.password, 'utf8') > 72) throw new BadRequestException('Password must not exceed 72 bytes');
    const email = dto.email.trim().toLowerCase();
    if (!dto.localLoginEnabled && dto.microsoftLoginEnabled === false) throw new BadRequestException('At least one sign-in method must be enabled');
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ConflictException('Email address is already in use');
    const requestedRoles = await this.prisma.role.findMany({
      where: { id: { in: dto.roleIds }, isActive: true },
      select: { id: true, protection: true },
    });
    if (requestedRoles.length !== new Set(dto.roleIds).size) throw new BadRequestException('One or more roles do not exist or are inactive');
    this.assertAssignableRoles(requestedRoles, actor, false);
    if (dto.employeeId) {
      const employee = await this.prisma.employee.findFirst({
        where: { id: dto.employeeId, deletedAt: null },
        select: { id: true, userId: true },
      });
      if (!employee) throw new NotFoundException('Employee not found');
      if (employee.userId) throw new ConflictException('Employee is already linked to a user');
    }
    const microsoftProvisioning = dto.microsoftLoginEnabled === false
      ? undefined
      : await this.microsoftDirectory.provisionUser(email);
    return this.serializable(async (tx) => {
      const roles = await tx.role.findMany({ where: { id: { in: dto.roleIds }, isActive: true }, select: { id: true, code: true, protection: true } });
      if (roles.length !== new Set(dto.roleIds).size) throw new BadRequestException('One or more roles do not exist or are inactive');
      this.assertAssignableRoles(roles, actor, false);
      if (dto.employeeId) {
        const employee = await tx.employee.findFirst({ where: { id: dto.employeeId, deletedAt: null }, select: { id: true, userId: true } });
        if (!employee) throw new NotFoundException('Employee not found');
        if (employee.userId) throw new ConflictException('Employee is already linked to a user');
      }
      const passwordHash = dto.password ? await bcrypt.hash(dto.password, this.bcryptRounds()) : null;
      const account = await tx.user.create({
        data: {
          email, passwordHash,
          localLoginEnabled: dto.localLoginEnabled ?? false,
          microsoftLoginEnabled: dto.microsoftLoginEnabled ?? true,
          microsoftObjectId: microsoftProvisioning?.objectId,
        },
      });
      if (dto.employeeId) await tx.employee.update({ where: { id: dto.employeeId }, data: { userId: account.id } });
      await tx.userRole.createMany({ data: roles.map((role) => ({ userId: account.id, roleId: role.id, assignedById: actor.id, reason: dto.reason })) });
      await this.audit.record(tx, actor, {
        action: AuditAction.CREATE, resourceType: 'User', resourceId: account.id, targetUserId: account.id,
        summary: 'Login user created', reason: dto.reason,
        after: {
          email: account.email,
          localLoginEnabled: account.localLoginEnabled,
          microsoftLoginEnabled: account.microsoftLoginEnabled,
          microsoftAccessProvisioned: Boolean(microsoftProvisioning),
          microsoftAssignmentCreated: microsoftProvisioning?.assignmentCreated ?? false,
          roleCodes: roles.map((role) => role.code),
        },
      });
      await this.notifyAccessChange(tx, account.id, 'ACCOUNT_CREATED', 'Account created', 'Your HR account and initial access were created.', 'User', account.id);
      return tx.user.findUniqueOrThrow({ where: { id: account.id }, select: { id: true, email: true, isActive: true, authorizationVersion: true } });
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Email address is already in use');
      throw error;
    });
  }

  updateUser(targetId: string, dto: UpdateSystemUserDto, actor: RequestUser) {
    this.assertSystemScope(actor, 'user.manage', targetId);
    if (targetId === actor.id) throw new ForbiddenException('Self account changes are not permitted');
    return this.serializable(async (tx) => {
      const target = await tx.user.findFirst({ where: { id: targetId, deletedAt: null }, select: { id: true, authorizationVersion: true, localLoginEnabled: true, microsoftLoginEnabled: true } });
      if (!target) throw new NotFoundException('User not found');
      this.assertAuthorizationVersion(target.authorizationVersion, dto.expectedAuthorizationVersion);
      const localLoginEnabled = dto.localLoginEnabled ?? target.localLoginEnabled;
      const microsoftLoginEnabled = dto.microsoftLoginEnabled ?? target.microsoftLoginEnabled;
      if (!localLoginEnabled && !microsoftLoginEnabled) throw new BadRequestException('At least one sign-in method must remain enabled');
      const updated = await tx.user.updateMany({ where: { id: targetId, authorizationVersion: dto.expectedAuthorizationVersion }, data: { localLoginEnabled, microsoftLoginEnabled, authorizationVersion: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('User authorization changed; refresh and retry');
      await this.revokeUserSessions(tx, targetId);
      await this.notifyAccessChange(tx, targetId, 'SIGN_IN_METHODS_CHANGED', 'Sign-in methods changed', 'Your permitted sign-in methods were updated. Sign in again to continue.', 'User', targetId);
      await this.audit.record(tx, actor, { action: AuditAction.UPDATE, resourceType: 'User', resourceId: targetId, targetUserId: targetId, summary: 'User sign-in methods updated', reason: dto.reason, before: target, after: { localLoginEnabled, microsoftLoginEnabled } });
      return tx.user.findUniqueOrThrow({ where: { id: targetId }, select: { id: true, email: true, isActive: true, localLoginEnabled: true, microsoftLoginEnabled: true, authorizationVersion: true } });
    });
  }

  softDeleteUser(targetId: string, dto: SystemMutationDto, actor: RequestUser) {
    this.assertSystemScope(actor, 'user.delete_soft', targetId);
    if (targetId === actor.id) throw new ForbiddenException('Self deletion is not permitted');
    return this.serializable(async (tx) => {
      const target = await tx.user.findFirst({ where: { id: targetId, deletedAt: null }, select: { id: true, authorizationVersion: true, isActive: true } });
      if (!target) throw new NotFoundException('User not found');
      this.assertAuthorizationVersion(target.authorizationVersion, dto.expectedVersion);
      await this.assertNotFinalSuperAdmin(targetId, tx);
      const deletedAt = new Date();
      const updated = await tx.user.updateMany({ where: { id: targetId, authorizationVersion: dto.expectedVersion, deletedAt: null }, data: { isActive: false, deletedAt, authorizationVersion: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('User authorization changed; refresh and retry');
      await this.revokeUserSessions(tx, targetId);
      await this.notifyAccessChange(tx, targetId, 'ACCOUNT_DELETED', 'Account access removed', 'Your HR account was deactivated by an administrator.', 'User', targetId);
      await this.audit.record(tx, actor, { action: AuditAction.DELETE, resourceType: 'User', resourceId: targetId, targetUserId: targetId, summary: 'Login user soft-deleted', reason: dto.reason, before: target, after: { isActive: false, deletedAt } });
      return { deleted: true };
    });
  }

  async listUsers(query: QuerySystemUsersDto, actor: RequestUser) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const now = new Date();
    const access = this.authorization.scopeRule(actor, 'user.read', AccessScopeType.ALL_SYSTEM);
    const where: Prisma.UserWhereInput = {
      id: access.unrestricted
        ? (access.excludeIds.length ? { notIn: access.excludeIds } : undefined)
        : { in: access.includeIds, notIn: access.excludeIds },
      deletedAt: null,
      isActive: query.isActive,
      roles: query.roleId ? { some: { roleId: query.roleId, ...activeAssignmentWhere(now) } } : undefined,
      OR: query.search ? [
        { email: { contains: query.search, mode: 'insensitive' } },
        { employee: { firstName: { contains: query.search, mode: 'insensitive' } } },
        { employee: { lastName: { contains: query.search, mode: 'insensitive' } } },
      ] : undefined,
    };
    const select = {
      id: true, email: true, isActive: true, localLoginEnabled: true, microsoftLoginEnabled: true,
      authorizationVersion: true, createdAt: true, updatedAt: true,
      employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
      roles: {
        where: activeAssignmentWhere(now),
        select: { id: true, assignedAt: true, expiresAt: true, role: { select: { id: true, code: true, displayName: true, protection: true, version: true } } },
      },
      permissionOverrides: {
        where: { revokedAt: null, startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        select: { id: true, effect: true, scopeType: true, scopeIds: true, reason: true, startsAt: true, expiresAt: true, version: true, permission: { select: { id: true, code: true, displayName: true } } },
      },
    } satisfies Prisma.UserSelect;
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({ where, select, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.user.count({ where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  effectivePermissions(userId: string, actor: RequestUser) {
    this.assertSystemScope(actor, 'user.read', userId);
    return this.prisma.$transaction((tx) => this.effectivePermissionsWithClient(tx, userId));
  }

  changeUserStatus(targetId: string, dto: ChangeUserStatusDto, actor: RequestUser) {
    this.assertSystemScope(actor, 'user.deactivate', targetId);
    if (targetId === actor.id) throw new ForbiddenException('Self account-status changes are not permitted');
    return this.serializable(async (tx) => {
      const target = await tx.user.findFirst({ where: { id: targetId, deletedAt: null }, select: { id: true, isActive: true, authorizationVersion: true } });
      if (!target) throw new NotFoundException('User not found');
      this.assertAuthorizationVersion(target.authorizationVersion, dto.expectedAuthorizationVersion);
      if (target.isActive && !dto.isActive) await this.assertNotFinalSuperAdmin(targetId, tx);
      const updated = await tx.user.updateMany({
        where: { id: targetId, authorizationVersion: dto.expectedAuthorizationVersion },
        data: { isActive: dto.isActive, authorizationVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('User authorization changed; refresh and retry');
      await this.revokeUserSessions(tx, targetId);
      await this.notifyAccessChange(tx, targetId, 'ACCOUNT_STATUS_CHANGED', 'Account status changed', `Your HR account was ${dto.isActive ? 'enabled' : 'disabled'}.`, 'User', targetId);
      await this.audit.record(tx, actor, {
        action: AuditAction.UPDATE, resourceType: 'User', resourceId: targetId,
        summary: `Account ${dto.isActive ? 'enabled' : 'disabled'}`, reason: dto.reason,
        before: { isActive: target.isActive }, after: { isActive: dto.isActive }, targetUserId: targetId,
      });
      return tx.user.findUniqueOrThrow({ where: { id: targetId }, select: { id: true, email: true, isActive: true, authorizationVersion: true } });
    });
  }

  assignRoles(targetId: string, dto: AssignUserRolesDto, actor: RequestUser) {
    this.assertSystemScope(actor, 'role.assign', targetId);
    if (targetId === actor.id) throw new ForbiddenException('Self-role assignment is not permitted');
    if (!dto.roleIds.length) throw new BadRequestException('At least one active role is required');
    return this.serializable(async (tx) => {
      const target = await tx.user.findFirst({ where: { id: targetId, deletedAt: null }, select: { id: true, authorizationVersion: true } });
      if (!target) throw new NotFoundException('User not found');
      this.assertAuthorizationVersion(target.authorizationVersion, dto.expectedAuthorizationVersion);
      const roles = await tx.role.findMany({
        where: { id: { in: dto.roleIds }, isActive: true },
        select: { id: true, code: true, protection: true },
      });
      if (roles.length !== new Set(dto.roleIds).size) throw new BadRequestException('One or more roles do not exist or are inactive');
      this.assertAssignableRoles(roles, actor);
      const current = await tx.userRole.findMany({
        where: { userId: targetId, ...activeAssignmentWhere(new Date()) },
        select: { roleId: true, role: { select: { code: true, protection: true } } },
      });
      const desired = new Set(dto.roleIds);
      if (current.some((assignment) => assignment.role.protection !== RoleProtection.STANDARD && !desired.has(assignment.roleId))) {
        this.authorization.require(actor, 'role.assign_protected');
        this.authorization.requireRecentStepUp(actor);
      }
      if (current.some((assignment) => assignment.role.protection === RoleProtection.SUPER_ADMIN && !desired.has(assignment.roleId))) {
        this.authorization.require(actor, 'role.assign_protected');
        this.authorization.requireRecentStepUp(actor);
        await this.assertNotFinalSuperAdmin(targetId, tx);
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
      await this.notifyAccessChange(tx, targetId, 'ROLES_CHANGED', 'Access roles changed', 'Your role assignments changed. Sign in again to use the updated access.', 'UserRole', targetId);
      await this.audit.record(tx, actor, {
        action: AuditAction.UPDATE, resourceType: 'UserRole', resourceId: targetId,
        summary: 'Role assignments replaced', reason: dto.reason, targetUserId: targetId,
        before: { roleCodes: current.map((item) => item.role.code) }, after: { roleCodes: roles.map((role) => role.code) },
      });
      return this.effectivePermissionsWithClient(tx, targetId);
    });
  }

  createOverride(targetId: string, dto: CreatePermissionOverrideDto, actor: RequestUser) {
    this.assertSystemScope(actor, 'permission.assign', targetId);
    if (targetId === actor.id) throw new ForbiddenException('Self permission overrides are not permitted');
    if (dto.expiresAt && dto.startsAt && dto.expiresAt <= dto.startsAt) throw new BadRequestException('expiresAt must be after startsAt');
    return this.serializable(async (tx) => {
      const [target, permission] = await Promise.all([
        tx.user.findFirst({ where: { id: targetId, deletedAt: null }, select: { id: true, authorizationVersion: true } }),
        tx.permission.findFirst({ where: { id: dto.permissionId, isDeprecated: false }, select: { id: true, code: true, isProtected: true } }),
      ]);
      if (!target) throw new NotFoundException('User not found');
      if (!permission) throw new BadRequestException('Permission does not exist or is deprecated');
      this.assertAuthorizationVersion(target.authorizationVersion, dto.expectedAuthorizationVersion);
      if (permission.isProtected) {
        this.authorization.require(actor, 'permission.assign_protected');
        this.authorization.requireRecentStepUp(actor);
      }
      const created = await tx.userPermissionOverride.create({
        data: {
          userId: targetId, permissionId: permission.id, effect: dto.effect, scopeType: dto.scopeType,
          scopeIds: dto.scopeIds ?? [], startsAt: dto.startsAt, expiresAt: dto.expiresAt,
          assignedById: actor.id, reason: dto.reason,
        },
        include: { permission: true },
      });
      await this.invalidateUser(tx, targetId, dto.expectedAuthorizationVersion);
      await this.notifyAccessChange(tx, targetId, 'PERMISSION_OVERRIDE_ADDED', 'Direct access rule added', `A direct ${dto.effect.toLowerCase()} rule was added for ${permission.code}.`, 'UserPermissionOverride', created.id);
      await this.audit.record(tx, actor, {
        action: AuditAction.CREATE, resourceType: 'UserPermissionOverride', resourceId: created.id,
        summary: `${dto.effect} permission override created`, reason: dto.reason,
        permissionCode: permission.code, targetUserId: targetId, after: created,
      });
      return created;
    });
  }

  revokeOverride(targetId: string, overrideId: string, dto: RevokePermissionOverrideDto, actor: RequestUser) {
    this.assertSystemScope(actor, 'permission.assign', targetId);
    if (targetId === actor.id) throw new ForbiddenException('Self permission overrides are not permitted');
    return this.serializable(async (tx) => {
      const [target, override] = await Promise.all([
        tx.user.findFirst({ where: { id: targetId, deletedAt: null }, select: { authorizationVersion: true } }),
        tx.userPermissionOverride.findFirst({ where: { id: overrideId, userId: targetId, revokedAt: null }, include: { permission: true } }),
      ]);
      if (!target || !override) throw new NotFoundException('Permission override not found');
      if (override.version !== dto.expectedVersion) throw new ConflictException('Permission override changed; refresh and retry');
      if (override.permission.isProtected) {
        this.authorization.require(actor, 'permission.assign_protected');
        this.authorization.requireRecentStepUp(actor);
      }
      const revoked = await tx.userPermissionOverride.update({ where: { id: override.id }, data: { revokedAt: new Date(), revokedReason: dto.reason, version: { increment: 1 } } });
      await this.invalidateUser(tx, targetId, target.authorizationVersion);
      await this.notifyAccessChange(tx, targetId, 'PERMISSION_OVERRIDE_REVOKED', 'Direct access rule revoked', `The direct access rule for ${override.permission.code} was revoked.`, 'UserPermissionOverride', override.id);
      await this.audit.record(tx, actor, {
        action: AuditAction.REVOKE, resourceType: 'UserPermissionOverride', resourceId: override.id,
        summary: 'Permission override revoked', reason: dto.reason, permissionCode: override.permission.code, targetUserId: targetId,
      });
      return revoked;
    });
  }

  listRoles(actor: RequestUser) {
    const access = this.authorization.scopeRule(actor, 'role.read', AccessScopeType.ALL_SYSTEM);
    return this.prisma.role.findMany({
      where: { id: access.unrestricted ? (access.excludeIds.length ? { notIn: access.excludeIds } : undefined) : { in: access.includeIds, notIn: access.excludeIds } },
      select: {
        id: true, code: true, displayName: true, description: true, isBuiltIn: true, protection: true,
        isActive: true, version: true, createdAt: true, updatedAt: true,
        permissions: { select: { permission: true } }, _count: { select: { users: true } },
      },
      orderBy: [{ isBuiltIn: 'desc' }, { code: 'asc' }],
    });
  }

  createRole(dto: CreateRoleDto, actor: RequestUser) {
    this.assertSystemScope(actor, 'role.manage');
    return this.serializable(async (tx) => {
      const permissions = await this.requirePermissions(tx, dto.permissionIds ?? []);
      this.assertAssignablePermissions(permissions, actor);
      const role = await tx.role.create({
        data: {
          id: randomUUID(), code: dto.code, displayName: dto.displayName, description: dto.description, createdById: actor.id,
          permissions: { create: permissions.map((permission) => ({ permissionId: permission.id, assignedById: actor.id })) },
        },
        include: { permissions: { include: { permission: true } } },
      });
      await this.audit.record(tx, actor, { action: AuditAction.CREATE, resourceType: 'Role', resourceId: role.id, summary: 'Custom role created', reason: dto.reason });
      return role;
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Role code already exists');
      throw error;
    });
  }

  updateRole(id: string, dto: UpdateRoleDto, actor: RequestUser) {
    this.assertSystemScope(actor, 'role.manage', id);
    return this.serializable(async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, select: { id: true, version: true, isBuiltIn: true, protection: true } });
      if (!role) throw new NotFoundException('Role not found');
      if (role.isBuiltIn) throw new BadRequestException('Built-in roles are managed by the RBAC catalogue');
      if (role.version !== dto.expectedVersion) throw new ConflictException('Role changed; refresh and retry');
      const updated = await tx.role.updateMany({
        where: { id, version: dto.expectedVersion },
        data: { displayName: dto.displayName, description: dto.description, isActive: dto.isActive, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('Role changed; refresh and retry');
      await this.invalidateRoleUsers(tx, id);
      await this.audit.record(tx, actor, { action: AuditAction.UPDATE, resourceType: 'Role', resourceId: id, summary: 'Role updated', reason: dto.reason });
      return tx.role.findUniqueOrThrow({ where: { id } });
    });
  }

  replaceRolePermissions(id: string, dto: ReplaceRolePermissionsDto, actor: RequestUser) {
    this.assertSystemScope(actor, 'role.manage', id);
    return this.serializable(async (tx) => {
      const role = await tx.role.findUnique({
        where: { id },
        select: { id: true, version: true, isBuiltIn: true, users: { where: activeAssignmentWhere(new Date()), select: { userId: true } }, permissions: { select: { permissionId: true, permission: { select: { isProtected: true } } } } },
      });
      if (!role) throw new NotFoundException('Role not found');
      if (role.isBuiltIn) throw new BadRequestException('Built-in roles are managed by the RBAC catalogue');
      if (role.version !== dto.expectedVersion) throw new ConflictException('Role changed; refresh and retry');
      const permissions = await this.requirePermissions(tx, dto.permissionIds);
      this.assertAssignablePermissions(permissions, actor);
      const desiredPermissionIds = new Set(dto.permissionIds);
      if (role.permissions.some((link) => link.permission.isProtected && !desiredPermissionIds.has(link.permissionId))) {
        this.authorization.require(actor, 'permission.assign_protected');
        this.authorization.requireRecentStepUp(actor);
      }
      if (role.users.some((assignment) => assignment.userId === actor.id)) {
        const escalation = permissions.find((permission) => !actor.permissions.includes(permission.code));
        if (escalation) throw new ForbiddenException('Cannot add permissions to a role assigned to yourself');
      }
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: id, permissionId: permission.id, assignedById: actor.id })) });
      await tx.role.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.invalidateRoleUsers(tx, id);
      await this.audit.record(tx, actor, { action: AuditAction.UPDATE, resourceType: 'RolePermission', resourceId: id, summary: 'Role permissions replaced', reason: dto.reason });
      return tx.role.findUniqueOrThrow({ where: { id }, include: { permissions: { include: { permission: true } } } });
    });
  }

  deleteRole(id: string, dto: SystemMutationDto, actor: RequestUser) {
    this.assertSystemScope(actor, 'role.manage', id);
    return this.serializable(async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, select: { id: true, isBuiltIn: true, version: true, users: { select: { id: true }, take: 1 } } });
      if (!role) throw new NotFoundException('Role not found');
      if (role.version !== dto.expectedVersion) throw new ConflictException('Role changed; refresh and retry');
      if (role.isBuiltIn) throw new BadRequestException('Built-in roles cannot be deleted');
      if (role.users.length) throw new BadRequestException('Roles with assignment history cannot be deleted; deactivate the role instead');
      await tx.role.delete({ where: { id } });
      await this.audit.record(tx, actor, { action: AuditAction.DELETE, resourceType: 'Role', resourceId: id, summary: 'Custom role deleted', reason: dto.reason });
      return { deleted: true };
    });
  }

  listPermissions(actor: RequestUser) {
    const access = this.authorization.scopeRule(actor, 'permission.read', AccessScopeType.ALL_SYSTEM);
    return this.prisma.permission.findMany({
      where: { id: access.unrestricted ? (access.excludeIds.length ? { notIn: access.excludeIds } : undefined) : { in: access.includeIds, notIn: access.excludeIds } },
      select: { id: true, code: true, displayName: true, description: true, category: true, isProtected: true, isDeprecated: true },
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
    });
  }

  async listSessions(query: QuerySystemSessionsDto, actor: RequestUser) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const now = new Date();
    const where: Prisma.AuthSessionWhereInput = {
      ...this.sessionScopeWhere(actor),
      userId: query.userId,
      ...(query.active === true ? { revokedAt: null, expiresAt: { gt: now } } : {}),
      ...(query.active === false ? { OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }] } : {}),
      user: query.search ? { email: { contains: query.search, mode: 'insensitive' } } : undefined,
    };
    const [data, total] = await Promise.all([
      this.prisma.authSession.findMany({
        where,
        select: { id: true, provider: true, userAgent: true, createdAt: true, reauthenticatedAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true, authorizationVersion: true, user: { select: { id: true, email: true, isActive: true } } },
        orderBy: { lastSeenAt: 'desc' }, skip: (page - 1) * limit, take: limit,
      }),
      this.prisma.authSession.count({ where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  revokeAllSessions(dto: RevokeSystemSessionDto, actor: RequestUser) {
    this.assertSystemScope(actor, 'session.manage');
    return this.serializable(async (tx) => {
      const now = new Date();
      const sessions = await tx.authSession.findMany({
        where: { ...this.sessionScopeWhere(actor), revokedAt: null, expiresAt: { gt: now } },
        select: { id: true, userId: true },
      });
      const sessionIds = sessions.map((session) => session.id);
      const userIds = [...new Set(sessions.map((session) => session.userId))];
      const revoked = sessionIds.length
        ? await tx.authSession.updateMany({ where: { id: { in: sessionIds }, revokedAt: null }, data: { revokedAt: now } })
        : { count: 0 };
      if (userIds.length) {
        await tx.notification.createMany({
          data: userIds.map((userId) => ({
            userId, type: 'SESSION_REVOKED', title: 'Sessions revoked',
            message: 'An administrator revoked all active sessions.', resourceType: 'AuthSession', resourceId: actor.sessionId,
          })),
        });
      }
      await this.audit.record(tx, actor, {
        action: AuditAction.REVOKE, resourceType: 'AuthSessionBulk', resourceId: actor.sessionId,
        summary: 'Administrative bulk session revocation', reason: dto.reason,
        after: { revokedCount: revoked.count, affectedUserCount: userIds.length },
      });
      return {
        revokedCount: revoked.count,
        affectedUserCount: userIds.length,
        currentSessionRevoked: sessionIds.includes(actor.sessionId),
      };
    });
  }

  revokeSession(id: string, dto: RevokeSystemSessionDto, actor: RequestUser) {
    this.assertSystemScope(actor, 'session.manage', id);
    return this.serializable(async (tx) => {
      const session = await tx.authSession.findUnique({ where: { id }, select: { id: true, userId: true, revokedAt: true } });
      if (!session) throw new NotFoundException('Session not found');
      if (!session.revokedAt) await tx.authSession.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.notifyAccessChange(tx, session.userId, 'SESSION_REVOKED', 'Session revoked', 'An administrator revoked one of your active sessions.', 'AuthSession', id);
      await this.audit.record(tx, actor, { action: AuditAction.REVOKE, resourceType: 'AuthSession', resourceId: id, summary: 'Administrative session revocation', reason: dto.reason, targetUserId: session.userId });
      return { revoked: true };
    });
  }

  listWorkflowPolicies(actor: RequestUser) {
    const access = this.authorization.scopeRule(actor, 'workflow.policy.read', AccessScopeType.ALL_SYSTEM);
    return this.prisma.workflowStagePolicy.findMany({ where: { id: access.unrestricted ? (access.excludeIds.length ? { notIn: access.excludeIds } : undefined) : { in: access.includeIds, notIn: access.excludeIds } }, include: { primaryUser: { select: { id: true, email: true } }, members: { include: { user: { select: { id: true, email: true } } } } }, orderBy: [{ workflowType: 'asc' }, { stage: 'asc' }] });
  }

  updateWorkflowPolicy(workflowTypeValue: string, stageValue: string, dto: UpdateWorkflowPolicyDto, actor: RequestUser) {
    const workflowType = this.enumValue(WorkflowType, workflowTypeValue, 'workflow type');
    const stage = this.enumValue(LeaveApprovalStage, stageValue, 'workflow stage');
    return this.serializable(async (tx) => {
      const policy = await tx.workflowStagePolicy.findUnique({ where: { workflowType_stage: { workflowType, stage } } });
      if (!policy) throw new NotFoundException('Workflow policy not found');
      this.assertSystemScope(actor, 'workflow.policy.manage', policy.id);
      if (policy.version !== dto.expectedVersion) throw new ConflictException('Workflow policy changed; refresh and retry');
      const memberIds = dto.memberUserIds ?? [];
      if (dto.mode === ApproverMode.PRIMARY_APPROVER && !dto.primaryUserId) throw new BadRequestException('A primary approver is required');
      if (dto.mode === ApproverMode.NAMED_POOL && !memberIds.length) throw new BadRequestException('At least one named-pool approver is required');
      if (dto.mode === ApproverMode.ANY_ONE && (dto.primaryUserId || memberIds.length)) throw new BadRequestException('ANY_ONE approvers are derived from active qualified role holders');
      const userIds = [...new Set([...(dto.primaryUserId ? [dto.primaryUserId] : []), ...memberIds])];
      const activeUsers = await tx.user.count({ where: { id: { in: userIds }, isActive: true, deletedAt: null } });
      if (activeUsers !== userIds.length) throw new BadRequestException('One or more approvers are unavailable');
      await tx.workflowStagePolicy.update({ where: { id: policy.id }, data: { mode: dto.mode, primaryUserId: dto.primaryUserId ?? null, version: { increment: 1 } } });
      await tx.workflowStagePolicyMember.deleteMany({ where: { policyId: policy.id } });
      if (memberIds.length) await tx.workflowStagePolicyMember.createMany({ data: memberIds.map((userId) => ({ policyId: policy.id, userId })) });
      await this.audit.record(tx, actor, { action: AuditAction.UPDATE, resourceType: 'WorkflowStagePolicy', resourceId: policy.id, summary: 'Workflow policy updated', reason: dto.reason, before: policy, after: { mode: dto.mode, primaryUserId: dto.primaryUserId, memberUserIds: memberIds } });
      return tx.workflowStagePolicy.findUniqueOrThrow({ where: { id: policy.id }, include: { primaryUser: true, members: { include: { user: true } } } });
    });
  }

  listDelegations(actor: RequestUser) {
    const access = this.authorization.scopeRule(actor, 'workflow.delegation.read', AccessScopeType.ALL_SYSTEM);
    return this.prisma.workflowDelegation.findMany({ where: { id: access.unrestricted ? (access.excludeIds.length ? { notIn: access.excludeIds } : undefined) : { in: access.includeIds, notIn: access.excludeIds } }, include: { delegator: { select: { id: true, email: true } }, delegate: { select: { id: true, email: true } } }, orderBy: { createdAt: 'desc' } });
  }

  createDelegation(dto: CreateWorkflowDelegationDto, actor: RequestUser) {
    this.assertSystemScope(actor, 'workflow.delegation.manage');
    if (dto.delegatorUserId === dto.delegateUserId) throw new BadRequestException('Delegator and delegate must be different users');
    if (dto.endsAt <= dto.startsAt) throw new BadRequestException('endsAt must be after startsAt');
    return this.serializable(async (tx) => {
      const users = await tx.user.count({ where: { id: { in: [dto.delegatorUserId, dto.delegateUserId] }, isActive: true, deletedAt: null } });
      if (users !== 2) throw new BadRequestException('Delegator or delegate is unavailable');
      const overlapping = await tx.workflowDelegation.findFirst({
        where: { workflowType: dto.workflowType, stage: dto.stage, delegatorUserId: dto.delegatorUserId, revokedAt: null, startsAt: { lt: dto.endsAt }, endsAt: { gt: dto.startsAt } },
        select: { id: true },
      });
      if (overlapping) throw new ConflictException('An overlapping delegation already exists');
      const created = await tx.workflowDelegation.create({ data: { ...dto, createdById: actor.id } });
      await Promise.all([
        this.notifyAccessChange(tx, dto.delegatorUserId, 'WORKFLOW_DELEGATION_CREATED', 'Approval delegation created', 'An approval delegation was created for your workflow responsibilities.', 'WorkflowDelegation', created.id),
        this.notifyAccessChange(tx, dto.delegateUserId, 'WORKFLOW_DELEGATION_CREATED', 'Approval work delegated to you', 'You received a time-limited workflow approval delegation.', 'WorkflowDelegation', created.id),
      ]);
      await this.audit.record(tx, actor, { action: AuditAction.CREATE, resourceType: 'WorkflowDelegation', resourceId: created.id, summary: 'Workflow delegation created', reason: dto.reason, after: created });
      return created;
    });
  }

  revokeDelegation(id: string, dto: RevokeWorkflowDelegationDto, actor: RequestUser) {
    this.assertSystemScope(actor, 'workflow.delegation.manage', id);
    return this.serializable(async (tx) => {
      const delegation = await tx.workflowDelegation.findUnique({ where: { id } });
      if (!delegation || delegation.revokedAt) throw new NotFoundException('Active delegation not found');
      if (delegation.version !== dto.expectedVersion) throw new ConflictException('Delegation changed; refresh and retry');
      const revoked = await tx.workflowDelegation.update({ where: { id }, data: { revokedAt: new Date(), version: { increment: 1 } } });
      await Promise.all([
        this.notifyAccessChange(tx, delegation.delegatorUserId, 'WORKFLOW_DELEGATION_REVOKED', 'Approval delegation revoked', 'Your workflow approval delegation was revoked.', 'WorkflowDelegation', id),
        this.notifyAccessChange(tx, delegation.delegateUserId, 'WORKFLOW_DELEGATION_REVOKED', 'Delegated approval access ended', 'A workflow approval delegation assigned to you was revoked.', 'WorkflowDelegation', id),
      ]);
      await this.audit.record(tx, actor, { action: AuditAction.REVOKE, resourceType: 'WorkflowDelegation', resourceId: id, summary: 'Workflow delegation revoked', reason: dto.reason });
      return revoked;
    });
  }

  private assertSystemScope(actor: RequestUser, permission: string, resourceId?: string) {
    if (this.authorization.permissionAllowedForScope(actor, permission, AccessScopeType.ALL_SYSTEM, resourceId)) return;
    void this.audit.record(this.prisma, actor, {
      action: AuditAction.ACCESS,
      outcome: AuditOutcome.DENIED,
      resourceType: 'AuthorizationDenial',
      resourceId,
      permissionCode: permission,
      scopeType: AccessScopeType.ALL_SYSTEM,
      summary: 'System record access denied by scope policy',
      reason: 'System record access denied by scope policy',
    }).catch(() => undefined);
    if (resourceId) throw new NotFoundException('Record not found');
    throw new ForbiddenException('Insufficient permission');
  }

  private sessionScopeWhere(actor: RequestUser): Prisma.AuthSessionWhereInput {
    const access = this.authorization.scopeRule(actor, 'session.manage', AccessScopeType.ALL_SYSTEM);
    return {
      id: access.unrestricted
        ? (access.excludeIds.length ? { notIn: access.excludeIds } : undefined)
        : { in: access.includeIds, notIn: access.excludeIds },
    };
  }

  private notifyAccessChange(
    tx: Prisma.TransactionClient,
    userId: string,
    type: string,
    title: string,
    message: string,
    resourceType: string,
    resourceId: string,
  ) {
    return tx.notification.create({ data: { userId, type, title, message, resourceType, resourceId } });
  }

  private async requirePermissions(tx: Prisma.TransactionClient, permissionIds: string[]) {
    const permissions = await tx.permission.findMany({ where: { id: { in: permissionIds }, isDeprecated: false }, select: { id: true, code: true, isProtected: true } });
    if (permissions.length !== new Set(permissionIds).size) throw new BadRequestException('One or more permissions do not exist or are deprecated');
    return permissions;
  }

  private assertAssignablePermissions(permissions: Array<{ code: string; isProtected: boolean }>, actor: RequestUser) {
    if (permissions.some((permission) => permission.isProtected)) {
      this.authorization.require(actor, 'permission.assign_protected');
      this.authorization.requireRecentStepUp(actor);
    }
    const escalation = permissions.find((permission) => !actor.permissions.includes(permission.code));
    if (escalation && !hasActiveSuperAdminRole(actor)) throw new ForbiddenException('Cannot delegate a permission you do not hold');
  }

  private assertAssignableRoles(roles: Array<{ protection: RoleProtection }>, actor: RequestUser, requireRecentStepUp = true) {
    if (roles.some((role) => role.protection !== RoleProtection.STANDARD)) {
      this.authorization.require(actor, 'role.assign_protected');
      if (requireRecentStepUp) this.authorization.requireRecentStepUp(actor);
    }
  }

  private bcryptRounds() {
    const rounds = Number(this.config.get<number>('BCRYPT_SALT_ROUNDS', 12));
    if (!Number.isInteger(rounds) || rounds < 10 || rounds > 15) throw new Error('BCRYPT_SALT_ROUNDS must be between 10 and 15');
    return rounds;
  }

  private async assertNotFinalSuperAdmin(targetUserId: string, tx: Prisma.TransactionClient) {
    const targetAssignment = await tx.userRole.findFirst({
      where: {
        userId: targetUserId,
        ...activeAssignmentWhere(new Date()),
        role: { code: 'SUPER_ADMIN', protection: RoleProtection.SUPER_ADMIN, isActive: true },
      },
      select: { id: true },
    });
    if (!targetAssignment) return;

    const remaining = await tx.userRole.count({
      where: {
        userId: { not: targetUserId }, ...activeAssignmentWhere(new Date()),
        user: { isActive: true, deletedAt: null }, role: { code: 'SUPER_ADMIN', protection: RoleProtection.SUPER_ADMIN, isActive: true },
      },
    });
    if (remaining < 1) throw new BadRequestException('Cannot remove or disable the final active Super Administrator');
  }

  private async invalidateUser(tx: Prisma.TransactionClient, userId: string, expectedVersion: number) {
    const updated = await tx.user.updateMany({ where: { id: userId, authorizationVersion: expectedVersion }, data: { authorizationVersion: { increment: 1 } } });
    if (updated.count !== 1) throw new ConflictException('User authorization changed; refresh and retry');
    await this.revokeUserSessions(tx, userId);
  }

  private revokeUserSessions(tx: Prisma.TransactionClient, userId: string) {
    return tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async invalidateRoleUsers(tx: Prisma.TransactionClient, roleId: string) {
    const assignments = await tx.userRole.findMany({ where: { roleId, ...activeAssignmentWhere(new Date()) }, select: { userId: true } });
    const userIds = [...new Set(assignments.map((assignment) => assignment.userId))];
    if (!userIds.length) return;
    await tx.user.updateMany({ where: { id: { in: userIds } }, data: { authorizationVersion: { increment: 1 } } });
    await tx.authSession.updateMany({ where: { userId: { in: userIds }, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: 'ROLE_ACCESS_CHANGED',
        title: 'Role access changed',
        message: 'A role assigned to you changed. Sign in again to use the updated access.',
        resourceType: 'Role',
        resourceId: roleId,
      })),
    });
  }

  private async effectivePermissionsWithClient(tx: Prisma.TransactionClient, userId: string) {
    const now = new Date();
    const user = await tx.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true, email: true, authorizationVersion: true,
        roles: { where: activeAssignmentWhere(now), select: { role: { select: { id: true, code: true, displayName: true, protection: true, permissions: { select: { permission: true } } } } } },
        permissionOverrides: { where: { revokedAt: null, startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, include: { permission: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const isSuperAdmin = user.roles.some((assignment) => assignment.role.code === 'SUPER_ADMIN' && assignment.role.protection === RoleProtection.SUPER_ADMIN);
    const permissions = new Map<string, { id: string; code: string; displayName: string; category: string; sources: string[] }>();
    for (const assignment of user.roles) {
      for (const link of assignment.role.permissions) {
        const existing = permissions.get(link.permission.code);
        permissions.set(link.permission.code, { ...link.permission, sources: [...(existing?.sources ?? []), `role:${assignment.role.code}`] });
      }
    }
    for (const override of user.permissionOverrides) {
      if (override.effect === PermissionOverrideEffect.GRANT) {
        const existing = permissions.get(override.permission.code);
        permissions.set(override.permission.code, { ...override.permission, sources: [...(existing?.sources ?? []), `override:${override.id}:${override.scopeType}`] });
      } else if (!isSuperAdmin && override.scopeType === 'ALL_SYSTEM') {
        permissions.delete(override.permission.code);
      }
    }
    return {
      id: user.id, email: user.email, authorizationVersion: user.authorizationVersion,
      roles: user.roles.map((assignment) => ({ id: assignment.role.id, code: assignment.role.code, displayName: assignment.role.displayName, protection: assignment.role.protection })),
      permissions: [...permissions.values()].sort((a, b) => a.code.localeCompare(b.code)),
      overrides: user.permissionOverrides,
    };
  }

  private assertAuthorizationVersion(actual: number, expected: number) {
    if (actual !== expected) throw new ConflictException('User authorization changed; refresh and retry');
  }

  private enumValue<T extends Record<string, string>>(values: T, value: string, label: string): T[keyof T] {
    if (!Object.values(values).includes(value)) throw new BadRequestException(`Invalid ${label}`);
    return value as T[keyof T];
  }

  private async serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      }
    }
    throw new ConflictException('Authorization changed in another request. Refresh and retry.');
  }
}

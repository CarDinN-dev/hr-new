import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { AccessScopeType, AuditAction, EmploymentStatus, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { RequestUser } from '../../common/types/request-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { ApplyOrganizationRemediationDto, PreviewOrganizationRemediationDto } from './dto/system.dto';

const activeRoleWhere = (now: Date): Prisma.UserRoleWhereInput => ({
  revokedAt: null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  role: { isActive: true },
});
const activeEmploymentStatuses: EmploymentStatus[] = [EmploymentStatus.ACTIVE, EmploymentStatus.ON_LEAVE, EmploymentStatus.PROBATION];

const stateSelect = (now: Date) => ({
  id: true, employeeCode: true, firstName: true, lastName: true, managerId: true, userId: true, version: true, employmentStatus: true, deletedAt: true,
  user: {
    select: {
      id: true, isActive: true, deletedAt: true, authorizationVersion: true,
      roles: { where: activeRoleWhere(now), select: { role: { select: { id: true, code: true } } } },
    },
  },
}) satisfies Prisma.EmployeeSelect;

type OrganizationState = Awaited<ReturnType<OrganizationReadinessService['loadState']>>;

@Injectable()
export class OrganizationReadinessService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly authorization: AuthorizationService) {}

  async report(actor: RequestUser) {
    this.assertScope(actor, 'system.read');
    const state = await this.loadState(this.prisma);
    const result = this.analyze(state);
    await this.audit.record(this.prisma, actor, { action: AuditAction.ACCESS, resourceType: 'OrganizationReadiness', summary: 'Organization readiness report viewed', metadata: result.summary });
    return result;
  }

  async preview(dto: PreviewOrganizationRemediationDto, actor: RequestUser) {
    this.assertScope(actor, 'system.configure');
    this.assertScope(actor, 'role.assign');
    return this.buildPreview(await this.loadState(this.prisma), dto);
  }

  async apply(dto: ApplyOrganizationRemediationDto, key: string | undefined, actor: RequestUser) {
    this.assertScope(actor, 'system.configure');
    this.assertScope(actor, 'role.assign');
    this.authorization.requireRecentStepUp(actor);
    if (!key || key.length < 8 || key.length > 128) throw new BadRequestException('A valid Idempotency-Key header is required');
    const payloadHash = createHash('sha256').update(JSON.stringify({ ...dto, reason: undefined })).digest('hex');
    return this.serializable(async (tx) => {
      const existing = await tx.idempotencyRecord.findUnique({ where: { actorUserId_operation_key: { actorUserId: actor.id, operation: 'organization.remediation', key } } });
      if (existing) {
        if (existing.requestHash !== payloadHash) throw new ConflictException('Idempotency key was already used for a different remediation');
        return { applied: true, idempotent: true, previewHash: dto.previewHash, remediationId: existing.resourceId };
      }

      const state = await this.loadState(tx);
      const preview = this.buildPreview(state, dto);
      if (preview.previewHash !== dto.previewHash) throw new ConflictException('Organization data changed after preview; generate and approve a new preview');

      for (const change of preview.employeeManagerChanges) {
        await tx.employee.update({ where: { id: change.employeeId }, data: { managerId: change.managerId, version: { increment: 1 } } });
      }
      for (const change of preview.departmentManagerChanges) {
        await tx.department.update({ where: { id: change.departmentId }, data: { managerId: change.managerId } });
      }
      const affectedUsers = new Set<string>();
      for (const addition of preview.roleAdditions) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: addition.userId, roleId: addition.roleId } },
          create: { id: randomUUID(), userId: addition.userId, roleId: addition.roleId, assignedById: actor.id, reason: dto.reason },
          update: { revokedAt: null, expiresAt: null, assignedById: actor.id, assignedAt: new Date(), reason: dto.reason },
        });
        affectedUsers.add(addition.userId);
      }
      if (affectedUsers.size) {
        const userIds = [...affectedUsers];
        await tx.user.updateMany({ where: { id: { in: userIds } }, data: { authorizationVersion: { increment: 1 } } });
        await tx.authSession.updateMany({ where: { userId: { in: userIds }, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      const remediationId = randomUUID();
      await this.audit.record(tx, actor, {
        action: AuditAction.UPDATE, resourceType: 'OrganizationRemediation', resourceId: remediationId,
        summary: 'Approved reporting hierarchy remediation applied', reason: dto.reason,
        after: { employeeManagerChanges: preview.employeeManagerChanges, departmentManagerChanges: preview.departmentManagerChanges, roleAdditions: preview.roleAdditions.map(({ userId, roleCode }) => ({ userId, roleCode })) },
      });
      await tx.idempotencyRecord.create({ data: { actorUserId: actor.id, operation: 'organization.remediation', key, requestHash: payloadHash, resourceType: 'OrganizationRemediation', resourceId: remediationId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
      return { applied: true, idempotent: false, previewHash: dto.previewHash, remediationId };
    });
  }

  private async loadState(client: PrismaService | Prisma.TransactionClient) {
    const [employees, departments, roles, workflowPolicies] = await Promise.all([
      client.employee.findMany({ where: { deletedAt: null }, select: stateSelect(new Date()), orderBy: { employeeCode: 'asc' } }),
      client.department.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true, managerId: true, updatedAt: true }, orderBy: { code: 'asc' } }),
      client.role.findMany({ where: { code: { in: ['EMPLOYEE', 'LINE_MANAGER', 'MANAGER', 'SUPER_ADMIN'] }, isActive: true }, select: { id: true, code: true } }),
      client.workflowStagePolicy.findMany({ include: { primaryUser: { select: { id: true, isActive: true, deletedAt: true } }, members: { include: { user: { select: { id: true, isActive: true, deletedAt: true } } } } } }),
    ]);
    return { employees, departments, roles, workflowPolicies };
  }

  private analyze(state: OrganizationState) {
    const active = state.employees.filter((employee) => activeEmploymentStatuses.includes(employee.employmentStatus));
    const byId = new Map(active.map((employee) => [employee.id, employee]));
    const roleCodes = (employee: typeof active[number]) => new Set(employee.user?.roles.map((assignment) => assignment.role.code) ?? []);
    const topExecutives = new Set(active.filter((employee) => roleCodes(employee).has('COO')).map((employee) => employee.id));
    const directManagerIds = new Set(active.map((employee) => employee.managerId).filter((id): id is string => Boolean(id)));
    const managerOfManagerIds = new Set([...directManagerIds].map((id) => byId.get(id)?.managerId).filter((id): id is string => Boolean(id)));
    for (const department of state.departments) if (department.managerId) managerOfManagerIds.add(department.managerId);
    const employee = (id: string) => { const value = byId.get(id); return value ? { id, employeeCode: value.employeeCode, name: `${value.firstName} ${value.lastName}`.trim() } : { id }; };
    const missingManagers = active.filter((item) => !item.managerId && !topExecutives.has(item.id)).map((item) => employee(item.id));
    const invalidManagers = active.filter((item) => item.managerId && !byId.has(item.managerId)).map((item) => ({ ...employee(item.id), managerId: item.managerId }));
    const cycles: Array<{ employeeId: string; path: string[] }> = [];
    for (const item of active) {
      const path: string[] = [item.id]; let current = item.managerId;
      while (current && path.length <= 32) {
        if (path.includes(current)) { cycles.push({ employeeId: item.id, path: [...path, current] }); break; }
        path.push(current); current = byId.get(current)?.managerId ?? null;
      }
    }
    const managerIds = new Set([...directManagerIds, ...managerOfManagerIds]);
    const managersWithoutUsers = [...managerIds].filter((id) => !byId.get(id)?.user?.isActive || byId.get(id)?.user?.deletedAt).map(employee);
    const missingLineManagerRoles = [...directManagerIds].filter((id) => !roleCodes(byId.get(id)!).has('LINE_MANAGER')).map(employee);
    const missingManagerRoles = [...managerOfManagerIds].filter((id) => !roleCodes(byId.get(id)!).has('MANAGER')).map(employee);
    const loginUsersMissingEmployeeRole = active.filter((item) => item.user?.isActive && !roleCodes(item).has('EMPLOYEE')).map((item) => employee(item.id));
    const unmanagedDepartments = state.departments.filter((department) => !department.managerId).map(({ id, code, name }) => ({ id, code, name }));
    const invalidWorkflowPolicies = state.workflowPolicies.filter((policy) => {
      if (policy.mode === 'PRIMARY_APPROVER') return !policy.primaryUser?.isActive || Boolean(policy.primaryUser?.deletedAt);
      if (policy.mode === 'NAMED_POOL') return !policy.members.some((member) => member.user.isActive && !member.user.deletedAt);
      return false;
    }).map((policy) => ({ id: policy.id, workflowType: policy.workflowType, stage: policy.stage, mode: policy.mode }));
    const superAdminUsers = new Set(active.filter((item) => item.user?.isActive && roleCodes(item).has('SUPER_ADMIN')).map((item) => item.userId));
    const violations = { missingManagers, invalidManagers, cycles, managersWithoutUsers, missingLineManagerRoles, missingManagerRoles, loginUsersMissingEmployeeRole, unmanagedDepartments, invalidWorkflowPolicies, excessiveSuperAdministrators: Math.max(0, superAdminUsers.size - 2) };
    const summary = Object.fromEntries(Object.entries(violations).map(([name, value]) => [name, Array.isArray(value) ? value.length : value]));
    return { generatedAt: new Date().toISOString(), releaseReady: Object.values(summary).every((value) => value === 0), summary, violations };
  }

  private buildPreview(state: OrganizationState, dto: PreviewOrganizationRemediationDto) {
    this.assertUnique(dto.employeeManagers.map((item) => item.employeeId), 'employee');
    this.assertUnique(dto.departmentManagers.map((item) => item.departmentId), 'department');
    const active = state.employees.filter((employee) => activeEmploymentStatuses.includes(employee.employmentStatus));
    const byId = new Map(active.map((employee) => [employee.id, employee]));
    const departments = new Map(state.departments.map((department) => [department.id, department]));
    const managerMap = new Map(active.map((employee) => [employee.id, employee.managerId]));
    for (const change of dto.employeeManagers) {
      if (!byId.has(change.employeeId)) throw new BadRequestException(`Active employee ${change.employeeId} was not found`);
      if (change.managerId && !byId.has(change.managerId)) throw new BadRequestException(`Active manager ${change.managerId} was not found`);
      if (change.employeeId === change.managerId) throw new BadRequestException('An employee cannot manage themselves');
      managerMap.set(change.employeeId, change.managerId ?? null);
    }
    for (const id of managerMap.keys()) {
      const visited = new Set([id]); let current = managerMap.get(id);
      for (let depth = 0; current && depth < 32; depth += 1) {
        if (visited.has(current)) throw new BadRequestException(`Reporting line cycle includes employee ${id}`);
        visited.add(current); current = managerMap.get(current) ?? null;
      }
      if (current) throw new BadRequestException(`Reporting line for employee ${id} exceeds 32 levels`);
    }
    const departmentManagerMap = new Map(state.departments.map((department) => [department.id, department.managerId]));
    for (const change of dto.departmentManagers) {
      if (!departments.has(change.departmentId)) throw new BadRequestException(`Department ${change.departmentId} was not found`);
      if (change.managerId && !byId.has(change.managerId)) throw new BadRequestException(`Active department manager ${change.managerId} was not found`);
      departmentManagerMap.set(change.departmentId, change.managerId ?? null);
    }
    const directManagerIds = new Set([...managerMap.values()].filter((id): id is string => Boolean(id)));
    const managerIds = new Set([...directManagerIds].map((id) => managerMap.get(id)).filter((id): id is string => Boolean(id)));
    for (const id of departmentManagerMap.values()) if (id) managerIds.add(id);
    const roleByCode = new Map(state.roles.map((role) => [role.code, role]));
    for (const code of ['EMPLOYEE', 'LINE_MANAGER', 'MANAGER']) if (!roleByCode.has(code)) throw new BadRequestException(`Required role ${code} is unavailable`);
    const required = new Map<string, Set<string>>();
    for (const item of active) if (item.user?.isActive && !item.user.deletedAt) required.set(item.id, new Set(['EMPLOYEE']));
    for (const id of directManagerIds) required.get(id)?.add('LINE_MANAGER');
    for (const id of managerIds) required.get(id)?.add('MANAGER');
    const roleAdditions = [...required.entries()].flatMap(([employeeId, codes]) => {
      const item = byId.get(employeeId)!;
      if (!item.user?.isActive || item.user.deletedAt) {
        if (codes.size > 1) throw new BadRequestException(`Manager ${item.employeeCode} requires an active linked user before remediation`);
        return [];
      }
      const current = new Set(item.user.roles.map((assignment) => assignment.role.code));
      return [...codes].filter((code) => !current.has(code)).map((roleCode) => ({ employeeId, userId: item.user!.id, roleId: roleByCode.get(roleCode)!.id, roleCode }));
    });
    const employeeManagerChanges = dto.employeeManagers.map((change) => ({ employeeId: change.employeeId, before: byId.get(change.employeeId)!.managerId, managerId: change.managerId ?? null })).filter((change) => change.before !== change.managerId);
    const departmentManagerChanges = dto.departmentManagers.map((change) => ({ departmentId: change.departmentId, before: departments.get(change.departmentId)!.managerId, managerId: change.managerId ?? null })).filter((change) => change.before !== change.managerId);
    const stateFingerprint = {
      employees: active.map((item) => [item.id, item.managerId, item.version, item.user?.authorizationVersion, item.user?.roles.map((assignment) => assignment.role.code).sort()]),
      departments: state.departments.map((item) => [item.id, item.managerId, item.updatedAt.toISOString()]),
    };
    const previewHash = createHash('sha256').update(JSON.stringify({ employeeManagerChanges, departmentManagerChanges, roleAdditions, stateFingerprint })).digest('hex');
    return { previewHash, employeeManagerChanges, departmentManagerChanges, roleAdditions };
  }

  private assertUnique(ids: string[], label: string) {
    if (new Set(ids).size !== ids.length) throw new BadRequestException(`Each ${label} may appear only once`);
  }

  private assertScope(actor: RequestUser, permission: string) {
    if (!this.authorization.permissionAllowedForScope(actor, permission, AccessScopeType.ALL_SYSTEM)) throw new ForbiddenException('Insufficient permission');
  }

  private async serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error; }
    }
    throw new ConflictException('Organization data changed concurrently; preview again');
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccessScopeType, ApproverMode, AuditAction, LeaveApprovalStage, LeaveDecisionType,
  LeaveRequestStatus, LeaveRouteType, LeaveStepStatus, PayrollRunStatus, Prisma, WorkflowType,
} from '@prisma/client';
import { createHash } from 'crypto';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, listRecords, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { CreateLeaveBalanceDto } from './dto/create-leave-balance.dto';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { LeaveDecisionDto, LeaveReasonDecisionDto, OverrideLeaveDto, ReassignLeaveStepDto } from './dto/leave-workflow.dto';
import { QueryLeaveBalancesDto } from './dto/query-leave-balances.dto';
import { QueryLeaveRequestsDto } from './dto/query-leave-requests.dto';
import { QueryLeaveTypesDto } from './dto/query-leave-types.dto';
import { UpdateLeaveBalanceDto } from './dto/update-leave-balance.dto';
import { UpdateLeaveRequestDto } from './dto/update-leave-request.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';

const stagePermission: Record<LeaveApprovalStage, string> = {
  LINE_MANAGER: 'leave.team.approve_line_manager',
  MANAGER: 'leave.management.approve_manager',
  HR: 'leave.hr.approve',
  CPO: 'leave.executive.approve_cpo',
  COO: 'leave.executive.approve_coo',
};

const stageRole: Record<LeaveApprovalStage, string> = {
  LINE_MANAGER: 'LINE_MANAGER', MANAGER: 'MANAGER', HR: 'HR', CPO: 'CPO', COO: 'COO',
};

const stageStatus: Record<LeaveApprovalStage, LeaveRequestStatus> = {
  LINE_MANAGER: LeaveRequestStatus.PENDING_LINE_MANAGER,
  MANAGER: LeaveRequestStatus.PENDING_MANAGER,
  HR: LeaveRequestStatus.PENDING_HR,
  CPO: LeaveRequestStatus.PENDING_CPO,
  COO: LeaveRequestStatus.PENDING_COO,
};

const activePendingStatuses = [
  LeaveRequestStatus.PENDING_LINE_MANAGER, LeaveRequestStatus.PENDING_MANAGER,
  LeaveRequestStatus.PENDING_HR, LeaveRequestStatus.PENDING_CPO, LeaveRequestStatus.PENDING_COO,
  LeaveRequestStatus.RETURNED_FOR_CORRECTION, LeaveRequestStatus.BLOCKED_APPROVER_MISSING,
];

const leaveRequestInclude = {
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true, managerId: true, departmentId: true } },
  requester: { select: { id: true, email: true } },
  leaveType: true,
  steps: {
    orderBy: [{ workflowVersion: 'asc' as const }, { sequence: 'asc' as const }],
    include: {
      assignees: { include: { user: { select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } } } } },
      decidedBy: { select: { id: true, email: true } },
    },
  },
  decisions: { orderBy: { createdAt: 'asc' as const }, include: { actor: { select: { id: true, email: true } } } },
} satisfies Prisma.LeaveRequestInclude;

const leaveBalanceInclude = {
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true, managerId: true } },
  leaveType: true,
} satisfies Prisma.LeaveBalanceInclude;

type WorkflowStepPlan = {
  stage: LeaveApprovalStage;
  roleCode: string;
  assigneeUserIds: string[];
  selfApprovalAllowed: boolean;
};
type LeaveRequestView = Prisma.LeaveRequestGetPayload<{ include: typeof leaveRequestInclude }>;

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  createType(dto: CreateLeaveTypeDto, user: RequestUser) {
    return this.leaveTransaction(async (tx) => {
      const type = await tx.leaveType.create({ data: { ...dto, code: dto.code.toUpperCase() } });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, resourceType: 'LeaveType', resourceId: type.id, summary: 'Leave type created', after: type });
      return type;
    });
  }

  listTypes(query: QueryLeaveTypesDto) {
    return listRecords(this.prisma.leaveType, query, {
      searchFields: ['name', 'code', 'description'], allowedSortFields: ['createdAt', 'name', 'code', 'annualAllowanceDays'], defaultSortBy: 'createdAt',
    });
  }

  async findTypeById(id: string) {
    const type = await this.prisma.leaveType.findFirst({ where: { id, deletedAt: null } });
    if (!type) throw new NotFoundException('Leave type not found');
    return type;
  }

  async updateType(id: string, dto: UpdateLeaveTypeDto, user: RequestUser) {
    return this.leaveTransaction(async (tx) => {
      const existing = await tx.leaveType.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException('Leave type not found');
      const type = await tx.leaveType.update({ where: { id }, data: { ...dto, code: dto.code?.toUpperCase() } });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, resourceType: 'LeaveType', resourceId: id, summary: 'Leave type updated', before: existing, after: type });
      return type;
    });
  }

  async removeType(id: string, user: RequestUser) {
    return this.leaveTransaction(async (tx) => {
      const existing = await tx.leaveType.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException('Leave type not found');
      const activeBalance = await tx.leaveBalance.findFirst({ where: { leaveTypeId: id, deletedAt: null }, select: { id: true } });
      if (activeBalance) throw new BadRequestException('Remove active leave balances before deleting this leave type');
      const type = await tx.leaveType.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, resourceType: 'LeaveType', resourceId: id, summary: 'Leave type archived', before: existing, after: type });
      return type;
    });
  }

  async createBalance(dto: CreateLeaveBalanceDto, user: RequestUser) {
    await Promise.all([this.ensureEmployee(dto.employeeId), this.findTypeById(dto.leaveTypeId)]);
    this.assertBalanceValues(dto.totalDays, dto.usedDays ?? 0, dto.pendingDays ?? 0);
    return this.leaveTransaction(async (tx) => {
      const balance = await tx.leaveBalance.create({ data: dto, include: leaveBalanceInclude });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, resourceType: 'LeaveBalance', resourceId: balance.id, summary: 'Leave balance created', subjectEmployeeId: dto.employeeId, after: balance });
      return balance;
    });
  }

  async listBalances(query: QueryLeaveBalancesDto, user: RequestUser) {
    const filters: Prisma.LeaveBalanceWhereInput[] = [await this.balanceAccessWhere(user)];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.leaveTypeId) filters.push({ leaveTypeId: query.leaveTypeId });
    if (query.year) filters.push({ year: query.year });
    const { page, limit, ...args } = listArgs(query, {
      allowedSortFields: ['createdAt', 'year', 'totalDays', 'usedDays', 'pendingDays'], defaultSortBy: 'createdAt',
      where: { AND: filters }, include: leaveBalanceInclude,
    });
    const [data, total] = await Promise.all([this.prisma.leaveBalance.findMany(args), this.prisma.leaveBalance.count({ where: args.where })]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findBalanceById(id: string, user: RequestUser) {
    const balance = await this.prisma.leaveBalance.findFirst({ where: { AND: [{ id }, { deletedAt: null }, await this.balanceAccessWhere(user)] }, include: leaveBalanceInclude });
    if (!balance) throw new NotFoundException('Leave balance not found');
    return balance;
  }

  updateBalance(id: string, dto: UpdateLeaveBalanceDto, user: RequestUser) {
    return this.leaveTransaction(async (tx) => {
      const balance = await tx.leaveBalance.findFirst({ where: { id, deletedAt: null } });
      if (!balance) throw new NotFoundException('Leave balance not found');
      this.assertBalanceValues(dto.totalDays ?? balance.totalDays, dto.usedDays ?? balance.usedDays, dto.pendingDays ?? balance.pendingDays);
      const updated = await tx.leaveBalance.update({ where: { id }, data: dto, include: leaveBalanceInclude });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, resourceType: 'LeaveBalance', resourceId: id, summary: 'Leave balance updated', subjectEmployeeId: balance.employeeId, before: balance, after: updated });
      return updated;
    });
  }

  removeBalance(id: string, user: RequestUser) {
    return this.leaveTransaction(async (tx) => {
      const balance = await tx.leaveBalance.findFirst({ where: { id, deletedAt: null } });
      if (!balance) throw new NotFoundException('Leave balance not found');
      const active = await tx.leaveRequest.findFirst({
        where: { employeeId: balance.employeeId, leaveTypeId: balance.leaveTypeId, status: { in: [...activePendingStatuses, LeaveRequestStatus.APPROVED] }, deletedAt: null }, select: { id: true },
      });
      if (active) throw new BadRequestException('Cancel active leave requests before deleting this balance');
      const removed = await tx.leaveBalance.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, resourceType: 'LeaveBalance', resourceId: id, summary: 'Leave balance archived', subjectEmployeeId: balance.employeeId });
      return removed;
    });
  }

  async createRequest(dto: CreateLeaveRequestDto, key: string | undefined, user: RequestUser) {
    const employeeId = await this.resolveRequestEmployee(dto.employeeId, user);
    const startDate = this.leaveDate(dto.startDate);
    const endDate = this.leaveDate(dto.endDate);
    const totalDays = this.leaveDuration(startDate, endDate, dto.isHalfDay ?? false);
    return this.leaveTransaction(async (tx) => {
      const duplicate = await this.idempotentResult(tx, user, 'leave.submit', key, dto);
      if (duplicate) return duplicate;
      const [employee, leaveType] = await Promise.all([
        tx.employee.findFirst({ where: { id: employeeId, deletedAt: null }, include: { user: { select: { id: true, isActive: true } } } }),
        tx.leaveType.findFirst({ where: { id: dto.leaveTypeId, deletedAt: null } }),
      ]);
      if (!employee?.userId || !employee.user?.isActive) throw new BadRequestException('Employee requires an active linked user account');
      if (!leaveType) throw new NotFoundException('Leave type not found');
      await this.assertLeavePeriodAvailable(employeeId, startDate, endDate, undefined, tx);
      if (leaveType.isPaid) await this.reserveBalance(tx, employeeId, dto.leaveTypeId, startDate.getUTCFullYear(), totalDays);
      const workflowVersion = 1;
      const workflow = await this.workflowPlan(tx, employee, employee.userId, workflowVersion);
      const request = await tx.leaveRequest.create({
        data: {
          requesterUserId: user.id, employeeId, leaveTypeId: dto.leaveTypeId, startDate, endDate, totalDays,
          isHalfDay: dto.isHalfDay ?? false, reason: dto.reason,
          status: workflow.blocked ? LeaveRequestStatus.BLOCKED_APPROVER_MISSING : stageStatus[workflow.steps[0].stage],
          currentStage: workflow.blocked?.stage ?? workflow.steps[0].stage,
          routeType: workflow.routeType, workflowVersion,
          requesterRoleCodesSnapshot: workflow.roleCodes,
          managerChainSnapshot: workflow.managerChain,
          departmentIdSnapshot: employee.departmentId,
        },
      });
      await this.createWorkflowSteps(tx, request.id, workflowVersion, workflow.steps);
      await this.notifyWorkflow(tx, request.id, workflow.blocked, workflow.steps);
      await this.audit.record(tx, user, {
        action: AuditAction.CREATE, resourceType: 'LeaveRequest', resourceId: request.id, workflowId: request.id,
        workflowStage: request.currentStage ?? undefined, workflowStatus: request.status,
        summary: workflow.blocked ? 'Leave request submitted with missing approver' : 'Leave request submitted',
        subjectEmployeeId: employeeId, after: request,
      });
      await this.saveIdempotency(tx, user, 'leave.submit', key, dto, request.id);
      return tx.leaveRequest.findUniqueOrThrow({ where: { id: request.id }, include: leaveRequestInclude });
    });
  }

  async listRequests(query: QueryLeaveRequestsDto, user: RequestUser) {
    const result = await this.listWithWhere(query, await this.requestAccessWhere(user));
    const visible = (await Promise.all((result.data as LeaveRequestView[]).map(async (request) => await this.canAccessRequest(user, request) ? request : null))).filter((request): request is LeaveRequestView => request !== null);
    return { ...result, data: visible };
  }

  async listMine(query: QueryLeaveRequestsDto, user: RequestUser) {
    if (!user.employeeId) throw new NotFoundException('No employee profile is linked to this user');
    if (!this.authorization.permissionAllowedForScope(user, 'leave.self.read', AccessScopeType.SELF, user.employeeId)) return { data: [], meta: paginationMeta(0, query.page ?? 1, query.limit ?? 20) };
    return this.listWithWhere(query, { employeeId: user.employeeId, requesterUserId: user.id });
  }

  async inbox(query: QueryLeaveRequestsDto, user: RequestUser) {
    // Prisma cannot compare columns in a nested filter. Filtering by active stage/version is completed below.
    const result = await this.listWithWhere({ ...query, limit: Math.min(query.limit ?? 20, 100) }, {
      deletedAt: null,
      steps: { some: { assignees: { some: { userId: user.id, isActive: true, revokedAt: null } } } },
      status: { in: [...activePendingStatuses.filter((status) => status !== LeaveRequestStatus.RETURNED_FOR_CORRECTION)] },
    });
    const data = result.data as LeaveRequestView[];
    return { ...result, data: data.filter((request) => request.steps.some((step) => step.workflowVersion === request.workflowVersion && step.stage === request.currentStage && step.assignees.some((assignee) => assignee.userId === user.id && assignee.isActive && !assignee.revokedAt) && this.authorization.permissionAllowedForScope(user, stagePermission[step.stage], AccessScopeType.ASSIGNED_APPROVALS, request.id))) };
  }

  async findRequestById(id: string, user: RequestUser) {
    const request = await this.prisma.leaveRequest.findFirst({ where: { id, deletedAt: null }, include: leaveRequestInclude });
    if (!request || !await this.canAccessRequest(user, request)) throw new NotFoundException('Leave request not found');
    return request;
  }

  timeline(id: string, user: RequestUser) {
    return this.findRequestById(id, user);
  }

  async history(employeeId: string, query: QueryLeaveRequestsDto, user: RequestUser) {
    await this.authorization.assertEmployeeScope(user, employeeId, {
      self: 'leave.self.read', team: 'leave.team.read', tree: 'leave.management.read', all: this.authorization.hasAny(user, ['leave.hr.read', 'leave.read_all']) ? (this.authorization.has(user, 'leave.read_all') ? 'leave.read_all' : 'leave.hr.read') : undefined,
    });
    return this.listWithWhere({ ...query, employeeId }, await this.requestAccessWhere(user));
  }

  updateRequest(id: string, dto: UpdateLeaveRequestDto, key: string | undefined, user: RequestUser) {
    return this.leaveTransaction(async (tx) => {
      const duplicate = await this.idempotentResult(tx, user, 'leave.correction', key, { id, dto });
      if (duplicate) return duplicate;
      const request = await this.ensureRequest(id, tx);
      if (request.requesterUserId !== user.id || request.employeeId !== user.employeeId) throw new NotFoundException('Leave request not found');
      if (request.status !== LeaveRequestStatus.RETURNED_FOR_CORRECTION) throw new BadRequestException('Only returned leave requests can be corrected');
      this.assertExpectedVersion(request.version, dto.expectedVersion);
      const nextTypeId = dto.leaveTypeId ?? request.leaveTypeId;
      const nextStart = this.leaveDate(dto.startDate ?? request.startDate);
      const nextEnd = this.leaveDate(dto.endDate ?? request.endDate);
      const nextHalf = dto.isHalfDay ?? request.isHalfDay;
      const nextDays = this.leaveDuration(nextStart, nextEnd, nextHalf);
      await this.assertLeavePeriodAvailable(request.employeeId, nextStart, nextEnd, id, tx);
      await this.adjustReservedBalance(tx, request, nextTypeId, nextStart.getUTCFullYear(), nextDays);
      const updated = await tx.leaveRequest.update({
        where: { id },
        data: { leaveTypeId: nextTypeId, startDate: nextStart, endDate: nextEnd, totalDays: nextDays, isHalfDay: nextHalf, reason: dto.reason ?? request.reason, version: { increment: 1 } },
        include: leaveRequestInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, resourceType: 'LeaveRequest', resourceId: id, workflowId: id, workflowStatus: updated.status, summary: 'Returned leave request corrected', subjectEmployeeId: request.employeeId, before: request, after: updated });
      await this.saveIdempotency(tx, user, 'leave.correction', key, { id, dto }, id);
      return updated;
    });
  }

  approve(id: string, dto: LeaveDecisionDto, key: string | undefined, user: RequestUser) {
    return this.decide(id, LeaveDecisionType.APPROVE, dto, key, user);
  }

  reject(id: string, dto: LeaveReasonDecisionDto, key: string | undefined, user: RequestUser) {
    return this.decide(id, LeaveDecisionType.REJECT, dto, key, user);
  }

  returnForCorrection(id: string, dto: LeaveReasonDecisionDto, key: string | undefined, user: RequestUser) {
    return this.decide(id, LeaveDecisionType.RETURN, dto, key, user);
  }

  selfApprove(id: string, dto: LeaveDecisionDto, key: string | undefined, user: RequestUser) {
    this.authorization.requireRecentStepUp(user);
    return this.leaveTransaction(async (tx) => {
      const duplicate = await this.idempotentResult(tx, user, 'leave.self-approve', key, { id, dto });
      if (duplicate) return duplicate;
      const request = await this.ensureRequest(id, tx);
      if (
        request.routeType !== LeaveRouteType.COO_SELF || request.requesterUserId !== user.id
        || request.employeeId !== user.employeeId || request.currentStage !== LeaveApprovalStage.COO
        || request.status !== LeaveRequestStatus.PENDING_COO || !user.roles.includes('COO')
      ) throw new ForbiddenException('COO self-approval conditions are not satisfied');
      this.assertExpectedVersion(request.version, dto.expectedVersion);
      const step = await this.activeStep(tx, request, user.id);
      if (!step.selfApprovalAllowed || !step.assignees.some((assignee) => assignee.userId === user.id)) throw new ForbiddenException('COO self-approval is not assigned to this session');
      const updated = await this.completeDecision(tx, request, step, user, LeaveDecisionType.SELF_APPROVE, LeaveRequestStatus.APPROVED, dto.reason, true);
      await this.saveIdempotency(tx, user, 'leave.self-approve', key, { id, dto }, id);
      return updated;
    });
  }

  resubmit(id: string, dto: LeaveDecisionDto, key: string | undefined, user: RequestUser) {
    return this.leaveTransaction(async (tx) => {
      const duplicate = await this.idempotentResult(tx, user, 'leave.resubmit', key, { id, dto });
      if (duplicate) return duplicate;
      const request = await this.ensureRequest(id, tx);
      if (request.requesterUserId !== user.id || request.employeeId !== user.employeeId) throw new NotFoundException('Leave request not found');
      if (request.status !== LeaveRequestStatus.RETURNED_FOR_CORRECTION) throw new BadRequestException('Only returned leave requests can be resubmitted');
      this.assertExpectedVersion(request.version, dto.expectedVersion);
      const employee = await tx.employee.findUnique({ where: { id: request.employeeId }, include: { user: { select: { id: true, isActive: true } } } });
      if (!employee?.userId || !employee.user?.isActive) throw new BadRequestException('Employee requires an active linked user account');
      const workflowVersion = request.workflowVersion + 1;
      const workflow = await this.workflowPlan(tx, employee, employee.userId, workflowVersion);
      await this.createWorkflowSteps(tx, request.id, workflowVersion, workflow.steps);
      const nextStatus = workflow.blocked ? LeaveRequestStatus.BLOCKED_APPROVER_MISSING : stageStatus[workflow.steps[0].stage];
      await tx.leaveRequest.update({
        where: { id },
        data: {
          status: nextStatus, currentStage: workflow.blocked?.stage ?? workflow.steps[0].stage,
          routeType: workflow.routeType, workflowVersion, requesterRoleCodesSnapshot: workflow.roleCodes,
          managerChainSnapshot: workflow.managerChain, departmentIdSnapshot: employee.departmentId, version: { increment: 1 },
        },
      });
      await tx.leaveDecision.create({ data: { requestId: id, actorUserId: user.id, decisionType: LeaveDecisionType.APPROVE, fromStatus: request.status, toStatus: nextStatus, reason: dto.reason, idempotencyKey: key } });
      await this.notifyWorkflow(tx, request.id, workflow.blocked, workflow.steps);
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, resourceType: 'LeaveRequest', resourceId: id, workflowId: id, workflowStage: workflow.blocked?.stage ?? workflow.steps[0].stage, workflowStatus: nextStatus, summary: 'Leave request resubmitted', subjectEmployeeId: request.employeeId, changes: [{ field: 'status', previousValue: request.status, nextValue: nextStatus }] });
      await this.saveIdempotency(tx, user, 'leave.resubmit', key, { id, dto }, id);
      return tx.leaveRequest.findUniqueOrThrow({ where: { id }, include: leaveRequestInclude });
    });
  }

  cancel(id: string, dto: LeaveReasonDecisionDto, key: string | undefined, user: RequestUser) {
    return this.leaveTransaction(async (tx) => {
      const duplicate = await this.idempotentResult(tx, user, 'leave.cancel', key, { id, dto });
      if (duplicate) return duplicate;
      const request = await this.ensureRequest(id, tx);
      const own = request.requesterUserId === user.id && request.employeeId === user.employeeId;
      if (!own && !this.authorization.has(user, 'leave.hr.manage') && !user.isSuperAdmin) throw new NotFoundException('Leave request not found');
      this.assertExpectedVersion(request.version, dto.expectedVersion);
      if (!([...activePendingStatuses, LeaveRequestStatus.APPROVED] as LeaveRequestStatus[]).includes(request.status)) throw new BadRequestException('This leave request cannot be cancelled');
      if (request.status === LeaveRequestStatus.APPROVED) {
        if (own && !this.authorization.has(user, 'leave.hr.manage') && !user.isSuperAdmin) throw new ForbiddenException('Approved leave requires HR cancellation');
        await this.assertPayrollIsOpen(request.employeeId, request.startDate, request.endDate, tx);
      }
      await this.releaseBalance(tx, request, request.status === LeaveRequestStatus.APPROVED);
      const active = await tx.leaveApprovalStep.findFirst({ where: { requestId: id, workflowVersion: request.workflowVersion, stage: request.currentStage ?? undefined } });
      if (active && active.status === LeaveStepStatus.PENDING) await tx.leaveApprovalStep.update({ where: { id: active.id }, data: { status: LeaveStepStatus.REJECTED, decisionType: LeaveDecisionType.CANCEL, decidedByUserId: user.id, decidedAt: new Date(), reason: dto.reason, version: { increment: 1 } } });
      await tx.leaveRequest.update({ where: { id }, data: { status: LeaveRequestStatus.CANCELLED, currentStage: null, finalDecisionAt: new Date(), version: { increment: 1 } } });
      await tx.leaveDecision.create({ data: { requestId: id, stepId: active?.id, actorUserId: user.id, stage: request.currentStage, decisionType: LeaveDecisionType.CANCEL, fromStatus: request.status, toStatus: LeaveRequestStatus.CANCELLED, reason: dto.reason, idempotencyKey: key } });
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, resourceType: 'LeaveRequest', resourceId: id, workflowId: id, workflowStage: request.currentStage ?? undefined, workflowStatus: LeaveRequestStatus.CANCELLED, summary: 'Leave request cancelled', reason: dto.reason, subjectEmployeeId: request.employeeId, changes: [{ field: 'status', previousValue: request.status, nextValue: LeaveRequestStatus.CANCELLED }] });
      await this.saveIdempotency(tx, user, 'leave.cancel', key, { id, dto }, id);
      return tx.leaveRequest.findUniqueOrThrow({ where: { id }, include: leaveRequestInclude });
    });
  }

  reassign(id: string, dto: ReassignLeaveStepDto, key: string | undefined, user: RequestUser) {
    return this.leaveTransaction(async (tx) => {
      const duplicate = await this.idempotentResult(tx, user, 'leave.reassign', key, { id, dto });
      if (duplicate) return duplicate;
      const request = await this.ensureRequest(id, tx);
      this.assertExpectedVersion(request.version, dto.expectedVersion);
      if (!request.currentStage || request.status === LeaveRequestStatus.RETURNED_FOR_CORRECTION) throw new BadRequestException('No active approval step can be reassigned');
      const step = await tx.leaveApprovalStep.findFirst({ where: { requestId: id, workflowVersion: request.workflowVersion, stage: request.currentStage }, include: { assignees: true } });
      if (!step) throw new ConflictException('Active workflow step is missing');
      if (request.routeType === LeaveRouteType.COO_SELF && step.selfApprovalAllowed) throw new BadRequestException('COO self-approval cannot be reassigned');
      if (dto.assigneeUserId === request.requesterUserId) throw new BadRequestException('Requester cannot be assigned to approve their own leave');
      if (!await this.userQualifies(tx, dto.assigneeUserId, step.assignedRoleCode, stagePermission[step.stage])) throw new BadRequestException('Replacement approver is not active or qualified');
      await tx.leaveApprovalStepAssignee.updateMany({ where: { stepId: step.id, isActive: true }, data: { isActive: false, revokedAt: new Date() } });
      await tx.leaveApprovalStepAssignee.upsert({ where: { stepId_userId: { stepId: step.id, userId: dto.assigneeUserId } }, create: { stepId: step.id, userId: dto.assigneeUserId }, update: { isActive: true, revokedAt: null } });
      await tx.leaveRequest.update({ where: { id }, data: { status: stageStatus[step.stage], version: { increment: 1 } } });
      await tx.leaveDecision.create({ data: { requestId: id, stepId: step.id, actorUserId: user.id, stage: step.stage, decisionType: LeaveDecisionType.REASSIGN, fromStatus: request.status, toStatus: stageStatus[step.stage], reason: dto.reason, idempotencyKey: key } });
      await tx.notification.create({ data: { userId: dto.assigneeUserId, type: 'LEAVE_ASSIGNED', title: 'Leave approval assigned', message: 'A leave request has been assigned to you.', resourceType: 'LeaveRequest', resourceId: id } });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, resourceType: 'LeaveApprovalStep', resourceId: step.id, workflowId: id, workflowStage: step.stage, workflowStatus: stageStatus[step.stage], summary: 'Leave approval step reassigned', reason: dto.reason, subjectEmployeeId: request.employeeId, before: { assigneeUserIds: step.assignees.map((item) => item.userId) }, after: { assigneeUserIds: [dto.assigneeUserId] } });
      await this.saveIdempotency(tx, user, 'leave.reassign', key, { id, dto }, id);
      return tx.leaveRequest.findUniqueOrThrow({ where: { id }, include: leaveRequestInclude });
    });
  }

  async eligibleAssignees(id: string, user: RequestUser) {
    if (!this.authorization.permissionAllowedForScope(user, 'leave.reassign', AccessScopeType.ASSIGNED_APPROVALS, id)) {
      throw new NotFoundException('Leave request not found');
    }
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, deletedAt: null },
      select: { requesterUserId: true, currentStage: true, workflowVersion: true },
    });
    if (!request?.currentStage) throw new NotFoundException('Active leave approval step not found');
    const step = await this.prisma.leaveApprovalStep.findFirst({
      where: { requestId: id, workflowVersion: request.workflowVersion, stage: request.currentStage },
      select: { assignedRoleCode: true, stage: true, selfApprovalAllowed: true },
    });
    if (!step || step.selfApprovalAllowed) throw new NotFoundException('Active leave approval step not found');
    const now = new Date();
    return this.prisma.user.findMany({
      where: {
        id: { not: request.requesterUserId },
        isActive: true,
        deletedAt: null,
        roles: {
          some: {
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            role: {
              code: step.assignedRoleCode,
              isActive: true,
              permissions: { some: { permission: { code: stagePermission[step.stage], isDeprecated: false } } },
            },
          },
        },
      },
      select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
      orderBy: { email: 'asc' },
    });
  }

  override(id: string, dto: OverrideLeaveDto, key: string | undefined, user: RequestUser) {
    if (!user.isSuperAdmin || !user.roles.includes('SUPER_ADMIN')) throw new ForbiddenException('Super Administrator override is required');
    this.authorization.requireRecentStepUp(user);
    if (!([LeaveRequestStatus.APPROVED, LeaveRequestStatus.REJECTED, LeaveRequestStatus.CANCELLED] as LeaveRequestStatus[]).includes(dto.targetStatus)) throw new BadRequestException('Invalid override target status');
    return this.leaveTransaction(async (tx) => {
      const duplicate = await this.idempotentResult(tx, user, 'leave.override', key, { id, dto });
      if (duplicate) return duplicate;
      const request = await this.ensureRequest(id, tx);
      this.assertExpectedVersion(request.version, dto.expectedVersion);
      if (!([...activePendingStatuses, LeaveRequestStatus.APPROVED] as LeaveRequestStatus[]).includes(request.status)) throw new BadRequestException('Terminal leave requests cannot be overridden');
      if (dto.targetStatus === LeaveRequestStatus.APPROVED) await this.finalizeBalance(tx, request);
      else await this.releaseBalance(tx, request, request.status === LeaveRequestStatus.APPROVED);
      const step = request.currentStage ? await tx.leaveApprovalStep.findFirst({ where: { requestId: id, workflowVersion: request.workflowVersion, stage: request.currentStage }, include: { assignees: { where: { isActive: true, revokedAt: null }, select: { userId: true } } } }) : null;
      const pendingSteps = await tx.leaveApprovalStep.findMany({ where: { requestId: id, workflowVersion: request.workflowVersion, status: LeaveStepStatus.PENDING }, include: { assignees: { where: { isActive: true, revokedAt: null }, select: { userId: true } } }, orderBy: { sequence: 'asc' } });
      if (step) await tx.leaveApprovalStep.update({ where: { id: step.id }, data: { status: dto.targetStatus === LeaveRequestStatus.APPROVED ? LeaveStepStatus.APPROVED : LeaveStepStatus.REJECTED, decisionType: LeaveDecisionType.OVERRIDE, decidedByUserId: user.id, decidedAt: new Date(), reason: dto.reason, version: { increment: 1 } } });
      await tx.leaveRequest.update({ where: { id }, data: { status: dto.targetStatus, currentStage: null, finalDecisionAt: new Date(), rejectionReason: dto.targetStatus === LeaveRequestStatus.REJECTED ? dto.reason : null, version: { increment: 1 } } });
      await tx.leaveDecision.create({ data: { requestId: id, stepId: step?.id, actorUserId: user.id, stage: request.currentStage, decisionType: LeaveDecisionType.OVERRIDE, fromStatus: request.status, toStatus: dto.targetStatus, reason: dto.reason, idempotencyKey: key, isOverride: true } });
      const hrUsers = await tx.user.findMany({ where: { isActive: true, deletedAt: null, roles: { some: { revokedAt: null, role: { isActive: true, permissions: { some: { permission: { code: 'leave.hr.read', isDeprecated: false } } } } } } }, select: { id: true } });
      const recipients = [...new Set([request.requesterUserId, ...(step?.assignees.map(({ userId }) => userId) ?? []), ...hrUsers.map(({ id: userId }) => userId), ...pendingSteps.flatMap((pending) => pending.assignees.map(({ userId }) => userId))])].filter((userId) => userId !== user.id);
      if (recipients.length) await tx.notification.createMany({ data: recipients.map((userId) => ({ userId, type: 'LEAVE_OVERRIDE', title: 'Leave workflow overridden', message: 'A Super Administrator changed a leave workflow decision.', resourceType: 'LeaveRequest', resourceId: id })) });
      await this.audit.record(tx, user, { action: AuditAction.OVERRIDE, resourceType: 'LeaveRequest', resourceId: id, workflowId: id, workflowStage: request.currentStage ?? undefined, workflowStatus: dto.targetStatus, summary: 'Leave workflow overridden', reason: dto.reason, subjectEmployeeId: request.employeeId, isOverride: true, before: { status: request.status, currentStage: request.currentStage, version: request.version }, after: { status: dto.targetStatus, currentStage: null, version: request.version + 1 }, metadata: { skippedStages: pendingSteps.map((pending) => pending.stage), affectedUserIds: recipients }, changes: [{ field: 'status', previousValue: request.status, nextValue: dto.targetStatus }] });
      await this.saveIdempotency(tx, user, 'leave.override', key, { id, dto }, id);
      return tx.leaveRequest.findUniqueOrThrow({ where: { id }, include: leaveRequestInclude });
    });
  }

  private decide(id: string, type: LeaveDecisionType, dto: LeaveDecisionDto, key: string | undefined, user: RequestUser) {
    return this.leaveTransaction(async (tx) => {
      const operation = `leave.${type.toLowerCase()}`;
      const duplicate = await this.idempotentResult(tx, user, operation, key, { id, dto });
      if (duplicate) return duplicate;
      const request = await this.ensureRequest(id, tx);
      this.assertExpectedVersion(request.version, dto.expectedVersion);
      if (!request.currentStage || !Object.values(stageStatus).includes(request.status)) throw new BadRequestException('No approval decision is available');
      if (request.requesterUserId === user.id || request.employeeId === user.employeeId) throw new ForbiddenException('Self-approval is not permitted');
      const step = await this.activeStep(tx, request, user.id);
      const permission = stagePermission[step.stage];
      if (!this.authorization.permissionAllowedForScope(user, permission, AccessScopeType.ASSIGNED_APPROVALS, request.id)) throw new ForbiddenException('Approval permission is not available for this request');
      let nextStatus: LeaveRequestStatus;
      if (type === LeaveDecisionType.REJECT) nextStatus = LeaveRequestStatus.REJECTED;
      else if (type === LeaveDecisionType.RETURN) nextStatus = LeaveRequestStatus.RETURNED_FOR_CORRECTION;
      else {
        const next = await tx.leaveApprovalStep.findFirst({ where: { requestId: id, workflowVersion: request.workflowVersion, sequence: { gt: step.sequence } }, orderBy: { sequence: 'asc' } });
        nextStatus = next ? (await tx.leaveApprovalStepAssignee.count({ where: { stepId: next.id, isActive: true, revokedAt: null } }) ? stageStatus[next.stage] : LeaveRequestStatus.BLOCKED_APPROVER_MISSING) : LeaveRequestStatus.APPROVED;
      }
      const updated = await this.completeDecision(tx, request, step, user, type, nextStatus, dto.reason, false);
      await this.saveIdempotency(tx, user, operation, key, { id, dto }, id);
      return updated;
    });
  }

  private async completeDecision(
    tx: Prisma.TransactionClient,
    request: Awaited<ReturnType<LeaveService['ensureRequest']>>,
    step: Awaited<ReturnType<LeaveService['activeStep']>>,
    user: RequestUser,
    type: LeaveDecisionType,
    nextStatus: LeaveRequestStatus,
    reason?: string,
    selfApproval = false,
  ) {
    if (([LeaveDecisionType.REJECT, LeaveDecisionType.RETURN] as LeaveDecisionType[]).includes(type) && (!reason || reason.trim().length < 3)) throw new BadRequestException('A decision reason is required');
    if (nextStatus === LeaveRequestStatus.APPROVED) await this.finalizeBalance(tx, request);
    if (nextStatus === LeaveRequestStatus.REJECTED) await this.releaseBalance(tx, request, false);
    const stepStatus = type === LeaveDecisionType.RETURN ? LeaveStepStatus.RETURNED : type === LeaveDecisionType.REJECT ? LeaveStepStatus.REJECTED : LeaveStepStatus.APPROVED;
    const stepUpdate = await tx.leaveApprovalStep.updateMany({
      where: { id: step.id, version: step.version, status: LeaveStepStatus.PENDING },
      data: { status: stepStatus, decidedByUserId: user.id, decidedAt: new Date(), decisionType: type, reason, isSelfApproval: selfApproval, version: { increment: 1 } },
    });
    if (stepUpdate.count !== 1) throw new ConflictException('This approval step was already decided');
    const nextStep = type === LeaveDecisionType.APPROVE && nextStatus !== LeaveRequestStatus.APPROVED
      ? await tx.leaveApprovalStep.findFirst({ where: { requestId: request.id, workflowVersion: request.workflowVersion, sequence: { gt: step.sequence } }, orderBy: { sequence: 'asc' } })
      : null;
    const terminal = ([LeaveRequestStatus.APPROVED, LeaveRequestStatus.REJECTED] as LeaveRequestStatus[]).includes(nextStatus);
    const updatedCount = await tx.leaveRequest.updateMany({
      where: { id: request.id, version: request.version, status: request.status },
      data: {
        status: nextStatus,
        currentStage: nextStatus === LeaveRequestStatus.RETURNED_FOR_CORRECTION || terminal ? null : (nextStep?.stage ?? step.stage),
        finalDecisionAt: terminal ? new Date() : null,
        rejectionReason: nextStatus === LeaveRequestStatus.REJECTED ? reason : null,
        version: { increment: 1 },
      },
    });
    if (updatedCount.count !== 1) throw new ConflictException('Leave request changed; refresh and retry');
    await tx.leaveDecision.create({
      data: { requestId: request.id, stepId: step.id, actorUserId: user.id, stage: step.stage, decisionType: type, fromStatus: request.status, toStatus: nextStatus, reason, isSelfApproval: selfApproval },
    });
    if (nextStep) {
      const assignees = await tx.leaveApprovalStepAssignee.findMany({ where: { stepId: nextStep.id, isActive: true, revokedAt: null }, select: { userId: true } });
      if (assignees.length) await tx.notification.createMany({ data: assignees.map(({ userId }) => ({ userId, type: 'LEAVE_APPROVAL', title: 'Leave approval required', message: 'A leave request is waiting for your decision.', resourceType: 'LeaveRequest', resourceId: request.id })) });
    }
    await tx.notification.create({ data: { userId: request.requesterUserId, type: 'LEAVE_STATUS', title: 'Leave request updated', message: `Your leave request is now ${nextStatus.replaceAll('_', ' ').toLowerCase()}.`, resourceType: 'LeaveRequest', resourceId: request.id } });
    await this.audit.record(tx, user, {
      action: AuditAction.TRANSITION, resourceType: 'LeaveRequest', resourceId: request.id, workflowId: request.id,
      workflowStage: step.stage, workflowStatus: nextStatus,
      summary: `${step.stage} leave decision recorded`, reason, subjectEmployeeId: request.employeeId,
      permissionCode: selfApproval ? 'leave.executive.self_approve_coo' : stagePermission[step.stage],
      scopeType: AccessScopeType.ASSIGNED_APPROVALS, isSelfApproval: selfApproval,
      changes: [{ field: 'status', previousValue: request.status, nextValue: nextStatus }],
    });
    return tx.leaveRequest.findUniqueOrThrow({ where: { id: request.id }, include: leaveRequestInclude });
  }

  private async workflowPlan(
    tx: Prisma.TransactionClient,
    employee: { id: string; managerId: string | null; departmentId: string | null },
    requesterUserId: string,
    _version: number,
  ) {
    const roleCodes = await this.activeRoleCodes(tx, requesterUserId);
    const organizationalRole = ['COO', 'CPO', 'HR', 'MANAGER', 'LINE_MANAGER', 'EMPLOYEE'].find((role) => roleCodes.includes(role)) ?? 'EMPLOYEE';
    const managerChain = await this.managerChain(tx, employee.id);
    let routeType: LeaveRouteType = LeaveRouteType.STANDARD;
    let stages: LeaveApprovalStage[];
    if (organizationalRole === 'COO') { routeType = LeaveRouteType.COO_SELF; stages = [LeaveApprovalStage.COO]; }
    else if (organizationalRole === 'CPO') { routeType = LeaveRouteType.CPO_TO_COO; stages = [LeaveApprovalStage.COO]; }
    else if (organizationalRole === 'HR') stages = [LeaveApprovalStage.CPO, LeaveApprovalStage.COO];
    else if (organizationalRole === 'MANAGER') stages = [LeaveApprovalStage.HR, LeaveApprovalStage.CPO, LeaveApprovalStage.COO];
    else if (organizationalRole === 'LINE_MANAGER') stages = [LeaveApprovalStage.MANAGER, LeaveApprovalStage.HR, LeaveApprovalStage.CPO, LeaveApprovalStage.COO];
    else stages = [LeaveApprovalStage.LINE_MANAGER, LeaveApprovalStage.MANAGER, LeaveApprovalStage.HR, LeaveApprovalStage.CPO, LeaveApprovalStage.COO];

    const steps: WorkflowStepPlan[] = [];
    let lineManagerEmployeeId: string | undefined;
    for (const stage of stages) {
      let assignees: string[] = [];
      const selfApprovalAllowed = routeType === LeaveRouteType.COO_SELF && stage === LeaveApprovalStage.COO;
      if (selfApprovalAllowed) assignees = [requesterUserId];
      else if (stage === LeaveApprovalStage.LINE_MANAGER) {
        lineManagerEmployeeId = managerChain[0];
        const userId = lineManagerEmployeeId ? await this.qualifiedUserByEmployee(tx, lineManagerEmployeeId, 'LINE_MANAGER', stagePermission[stage]) : null;
        if (userId) assignees = [userId];
      } else if (stage === LeaveApprovalStage.MANAGER) {
        const startIndex = lineManagerEmployeeId ? managerChain.indexOf(lineManagerEmployeeId) + 1 : 0;
        for (const employeeId of managerChain.slice(Math.max(0, startIndex))) {
          const userId = await this.qualifiedUserByEmployee(tx, employeeId, 'MANAGER', stagePermission[stage]);
          if (userId && userId !== requesterUserId) { assignees = [userId]; break; }
        }
      } else {
        assignees = await this.policyAssignees(tx, stage, requesterUserId);
      }
      if (!selfApprovalAllowed) assignees = await this.withDelegates(tx, stage, assignees, requesterUserId);
      assignees = [...new Set(assignees.filter((userId) => selfApprovalAllowed || userId !== requesterUserId))];
      steps.push({ stage, roleCode: stageRole[stage], assigneeUserIds: assignees, selfApprovalAllowed });
    }
    const blocked = steps[0] && !steps[0].assigneeUserIds.length ? steps[0] : undefined;
    return { routeType, roleCodes, managerChain, steps, blocked };
  }

  private async createWorkflowSteps(tx: Prisma.TransactionClient, requestId: string, workflowVersion: number, steps: WorkflowStepPlan[]) {
    for (let index = 0; index < steps.length; index += 1) {
      const plan = steps[index];
      await tx.leaveApprovalStep.create({
        data: {
          requestId, workflowVersion, sequence: index + 1, stage: plan.stage, assignedRoleCode: plan.roleCode,
          selfApprovalAllowed: plan.selfApprovalAllowed,
          assignees: { create: plan.assigneeUserIds.map((userId) => ({ userId })) },
        },
      });
    }
  }

  private async policyAssignees(tx: Prisma.TransactionClient, stage: LeaveApprovalStage, requesterUserId: string) {
    const policy = await tx.workflowStagePolicy.findUnique({
      where: { workflowType_stage: { workflowType: WorkflowType.LEAVE, stage } },
      include: { members: { select: { userId: true } } },
    });
    if (!policy) return [];
    let candidates: string[] = [];
    if (policy.mode === ApproverMode.PRIMARY_APPROVER) candidates = policy.primaryUserId ? [policy.primaryUserId] : [];
    else if (policy.mode === ApproverMode.NAMED_POOL) candidates = policy.members.map((member) => member.userId);
    else {
      const users = await tx.user.findMany({
        where: {
          isActive: true, deletedAt: null,
          roles: { some: { revokedAt: null, role: { code: stageRole[stage], isActive: true, permissions: { some: { permission: { code: stagePermission[stage], isDeprecated: false } } } } } },
        }, select: { id: true },
      });
      candidates = users.map((candidate) => candidate.id);
    }
    const qualified: string[] = [];
    for (const userId of [...new Set(candidates)]) if (userId !== requesterUserId && await this.userQualifies(tx, userId, stageRole[stage], stagePermission[stage])) qualified.push(userId);
    return qualified;
  }

  private async withDelegates(tx: Prisma.TransactionClient, stage: LeaveApprovalStage, assignees: string[], requesterUserId: string) {
    if (!assignees.length) return assignees;
    const now = new Date();
    const delegations = await tx.workflowDelegation.findMany({
      where: { workflowType: WorkflowType.LEAVE, stage, delegatorUserId: { in: assignees }, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
      select: { delegatorUserId: true, delegateUserId: true },
    });
    const result = [...assignees];
    for (const delegation of delegations) {
      if (delegation.delegateUserId !== requesterUserId && await this.userQualifies(tx, delegation.delegateUserId, stageRole[stage], stagePermission[stage])) result.push(delegation.delegateUserId);
    }
    return result;
  }

  private async qualifiedUserByEmployee(tx: Prisma.TransactionClient, employeeId: string, roleCode: string, permission: string) {
    const employee = await tx.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { userId: true } });
    return employee?.userId && await this.userQualifies(tx, employee.userId, roleCode, permission) ? employee.userId : null;
  }

  private async userQualifies(tx: Prisma.TransactionClient, userId: string, roleCode: string, permission: string) {
    const now = new Date();
    return Boolean(await tx.user.findFirst({
      where: {
        id: userId, isActive: true, deletedAt: null,
        roles: { some: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], role: { code: roleCode, isActive: true, permissions: { some: { permission: { code: permission, isDeprecated: false } } } } } },
      }, select: { id: true },
    }));
  }

  private async activeRoleCodes(tx: Prisma.TransactionClient, userId: string) {
    const now = new Date();
    const roles = await tx.userRole.findMany({ where: { userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], role: { isActive: true } }, select: { role: { select: { code: true } } } });
    return roles.map((assignment) => assignment.role.code);
  }

  private async managerChain(tx: Prisma.TransactionClient, employeeId: string) {
    const result: string[] = [];
    const visited = new Set([employeeId]);
    let currentId = employeeId;
    for (let depth = 0; depth < 32; depth += 1) {
      const employee: { managerId: string | null } | null = await tx.employee.findFirst({ where: { id: currentId, deletedAt: null }, select: { managerId: true } });
      if (!employee?.managerId || visited.has(employee.managerId)) break;
      visited.add(employee.managerId); result.push(employee.managerId); currentId = employee.managerId;
    }
    return result;
  }

  private async notifyWorkflow(tx: Prisma.TransactionClient, requestId: string, blocked: WorkflowStepPlan | undefined, steps: WorkflowStepPlan[]) {
    if (blocked) {
      const admins = await tx.user.findMany({ where: { isActive: true, deletedAt: null, roles: { some: { revokedAt: null, role: { code: { in: ['HR', 'ADMIN', 'SUPER_ADMIN'] }, isActive: true } } } }, select: { id: true } });
      if (admins.length) await tx.notification.createMany({ data: admins.map(({ id }) => ({ userId: id, type: 'LEAVE_BLOCKED', title: 'Leave workflow needs an approver', message: `A ${blocked.stage.toLowerCase()} approver could not be resolved.`, resourceType: 'LeaveRequest', resourceId: requestId })) });
      return;
    }
    const first = steps[0];
    if (first?.assigneeUserIds.length) await tx.notification.createMany({ data: first.assigneeUserIds.map((userId) => ({ userId, type: 'LEAVE_APPROVAL', title: 'Leave approval required', message: 'A leave request is waiting for your decision.', resourceType: 'LeaveRequest', resourceId: requestId })) });
  }

  private async activeStep(tx: Prisma.TransactionClient, request: Awaited<ReturnType<LeaveService['ensureRequest']>>, actorUserId: string) {
    if (!request.currentStage) throw new BadRequestException('No active approval step');
    const step = await tx.leaveApprovalStep.findFirst({
      where: { requestId: request.id, workflowVersion: request.workflowVersion, stage: request.currentStage, status: LeaveStepStatus.PENDING },
      include: { assignees: { where: { isActive: true, revokedAt: null } } },
    });
    if (!step || !step.assignees.some((assignee) => assignee.userId === actorUserId)) throw new NotFoundException('Leave request not found');
    return step;
  }

  private async listWithWhere(query: QueryLeaveRequestsDto, base: Prisma.LeaveRequestWhereInput) {
    const filters: Prisma.LeaveRequestWhereInput[] = [base, { deletedAt: null }];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.leaveTypeId) filters.push({ leaveTypeId: query.leaveTypeId });
    if (query.status) filters.push({ status: query.status });
    if (query.dateFrom) filters.push({ endDate: { gte: query.dateFrom } });
    if (query.dateTo) filters.push({ startDate: { lte: query.dateTo } });
    const { page, limit, ...args } = listArgs(query, { allowedSortFields: ['createdAt', 'startDate', 'endDate', 'totalDays', 'status'], defaultSortBy: 'createdAt', where: { AND: filters }, include: leaveRequestInclude });
    const [data, total] = await Promise.all([this.prisma.leaveRequest.findMany(args), this.prisma.leaveRequest.count({ where: args.where })]);
    return { data: data as unknown as LeaveRequestView[], meta: paginationMeta(total, page, limit) };
  }

  private async requestAccessWhere(user: RequestUser): Promise<Prisma.LeaveRequestWhereInput> {
    const scopes: Prisma.LeaveRequestWhereInput[] = [];
    for (const permission of ['leave.read_all', 'leave.hr.read', 'leave.audit.read'] as const) {
      const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_EMPLOYEES);
      if (rule.unrestricted) {
        if (!rule.excludeIds.length) return {};
        scopes.push({ employeeId: { notIn: rule.excludeIds } });
      }
      else if (rule.includeIds.length) scopes.push({ employeeId: { in: rule.includeIds } });
    }
    if (user.employeeId && this.authorization.permissionAllowedForScope(user, 'leave.self.read', AccessScopeType.SELF, user.employeeId)) scopes.push({ employeeId: user.employeeId });
    if (user.employeeId && this.authorization.has(user, 'leave.team.read')) {
      const ids = (await this.prisma.employee.findMany({ where: { managerId: user.employeeId, deletedAt: null }, select: { id: true } })).map(({ id }) => id).filter((id) => this.authorization.permissionAllowedForScope(user, 'leave.team.read', AccessScopeType.DIRECT_REPORTS, id));
      if (ids.length) scopes.push({ employeeId: { in: ids } });
    }
    if (user.employeeId && this.authorization.has(user, 'leave.management.read')) {
      const ids = await this.authorization.managementTreeEmployeeIds(user.employeeId);
      const allowed = ids.filter((id) => this.authorization.permissionAllowedForScope(user, 'leave.management.read', AccessScopeType.MANAGEMENT_TREE, id));
      if (allowed.length) scopes.push({ employeeId: { in: allowed } });
    }
    if (this.authorization.hasAny(user, Object.values(stagePermission))) {
      const assignedSteps = await this.prisma.leaveApprovalStep.findMany({
        where: { status: LeaveStepStatus.PENDING, assignees: { some: { userId: user.id, isActive: true, revokedAt: null } } },
        select: { stage: true, workflowVersion: true, request: { select: { id: true, workflowVersion: true, currentStage: true } } },
      });
      const ids = assignedSteps.filter((step) => step.workflowVersion === step.request.workflowVersion && step.stage === step.request.currentStage && this.authorization.permissionAllowedForScope(user, stagePermission[step.stage], AccessScopeType.ASSIGNED_APPROVALS, step.request.id)).map((step) => step.request.id);
      if (ids.length) scopes.push({ id: { in: ids } });
    }
    return scopes.length ? { OR: scopes } : { id: '__no_leave_scope__' };
  }

  private async canAccessRequest(user: RequestUser, request: LeaveRequestView) {
    for (const permission of ['leave.read_all', 'leave.hr.read', 'leave.audit.read'] as const) if (this.authorization.permissionAllowedForScope(user, permission, AccessScopeType.ALL_EMPLOYEES, request.employeeId)) return true;
    if (request.employeeId === user.employeeId && this.authorization.permissionAllowedForScope(user, 'leave.self.read', AccessScopeType.SELF, request.employeeId)) return true;
    if (request.employee.managerId === user.employeeId && this.authorization.permissionAllowedForScope(user, 'leave.team.read', AccessScopeType.DIRECT_REPORTS, request.employeeId)) return true;
    if (user.employeeId && await this.authorization.isInManagementTree(user.employeeId, request.employeeId) && this.authorization.permissionAllowedForScope(user, 'leave.management.read', AccessScopeType.MANAGEMENT_TREE, request.employeeId)) return true;
    return request.steps.some((step) => step.workflowVersion === request.workflowVersion && step.stage === request.currentStage && step.assignees.some((assignee) => assignee.userId === user.id && assignee.isActive && !assignee.revokedAt) && this.authorization.permissionAllowedForScope(user, stagePermission[step.stage], AccessScopeType.ASSIGNED_APPROVALS, request.id));
  }

  private async balanceAccessWhere(user: RequestUser): Promise<Prisma.LeaveBalanceWhereInput> {
    const scopes: Prisma.LeaveBalanceWhereInput[] = [];
    for (const permission of ['leave.read_all', 'leave.hr.read', 'leave.audit.read'] as const) {
      const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_EMPLOYEES);
      if (rule.unrestricted) {
        if (!rule.excludeIds.length) return {};
        scopes.push({ employeeId: { notIn: rule.excludeIds } });
      }
      else if (rule.includeIds.length) scopes.push({ employeeId: { in: rule.includeIds } });
    }
    if (user.employeeId && this.authorization.permissionAllowedForScope(user, 'leave.self.read', AccessScopeType.SELF, user.employeeId)) scopes.push({ employeeId: user.employeeId });
    if (user.employeeId && this.authorization.has(user, 'leave.team.read')) {
      const ids = (await this.prisma.employee.findMany({ where: { managerId: user.employeeId, deletedAt: null }, select: { id: true } })).map(({ id }) => id).filter((id) => this.authorization.permissionAllowedForScope(user, 'leave.team.read', AccessScopeType.DIRECT_REPORTS, id));
      if (ids.length) scopes.push({ employeeId: { in: ids } });
    }
    if (user.employeeId && this.authorization.has(user, 'leave.management.read')) {
      const ids = await this.authorization.managementTreeEmployeeIds(user.employeeId);
      const allowed = ids.filter((id) => this.authorization.permissionAllowedForScope(user, 'leave.management.read', AccessScopeType.MANAGEMENT_TREE, id));
      if (allowed.length) scopes.push({ employeeId: { in: allowed } });
    }
    return scopes.length ? { OR: scopes } : { id: '__no_leave_scope__' };
  }

  private async resolveRequestEmployee(employeeId: string | undefined, user: RequestUser) {
    const target = employeeId ?? user.employeeId;
    if (!target) throw new NotFoundException('No employee profile is linked to this user');
    if (target === user.employeeId) {
      if (!this.authorization.permissionAllowedForScope(user, 'leave.self.create', AccessScopeType.SELF, target)) throw new NotFoundException('Employee not found');
    } else if (!this.authorization.permissionAllowedForScope(user, 'leave.hr.manage', AccessScopeType.ALL_EMPLOYEES, target)) throw new ForbiddenException('Only HR may submit leave for another employee');
    return target;
  }

  private async reserveBalance(tx: Prisma.TransactionClient, employeeId: string, leaveTypeId: string, year: number, days: Prisma.Decimal) {
    const balance = await this.findBalance(employeeId, leaveTypeId, year, tx);
    const available = balance.totalDays.minus(balance.usedDays).minus(balance.pendingDays);
    if (available.lt(days)) throw new BadRequestException('Insufficient leave balance');
    await tx.leaveBalance.update({ where: { id: balance.id }, data: { pendingDays: { increment: days } } });
  }

  private async finalizeBalance(tx: Prisma.TransactionClient, request: { employeeId: string; leaveTypeId: string; startDate: Date; totalDays: Prisma.Decimal; status: LeaveRequestStatus }) {
    const type = await tx.leaveType.findFirst({ where: { id: request.leaveTypeId, deletedAt: null } });
    if (!type) throw new NotFoundException('Leave type not found');
    if (!type.isPaid || request.status === LeaveRequestStatus.APPROVED) return;
    const balance = await this.findBalance(request.employeeId, request.leaveTypeId, request.startDate.getUTCFullYear(), tx);
    if (balance.pendingDays.lt(request.totalDays)) throw new ConflictException('Leave balance is inconsistent');
    await tx.leaveBalance.update({ where: { id: balance.id }, data: { pendingDays: { decrement: request.totalDays }, usedDays: { increment: request.totalDays } } });
  }

  private async releaseBalance(tx: Prisma.TransactionClient, request: { employeeId: string; leaveTypeId: string; startDate: Date; totalDays: Prisma.Decimal; status: LeaveRequestStatus }, fromUsed: boolean) {
    const type = await tx.leaveType.findFirst({ where: { id: request.leaveTypeId, deletedAt: null } });
    if (!type?.isPaid) return;
    const balance = await this.findBalance(request.employeeId, request.leaveTypeId, request.startDate.getUTCFullYear(), tx);
    const current = fromUsed ? balance.usedDays : balance.pendingDays;
    if (current.lt(request.totalDays)) throw new ConflictException('Leave balance is inconsistent');
    await tx.leaveBalance.update({ where: { id: balance.id }, data: fromUsed ? { usedDays: { decrement: request.totalDays } } : { pendingDays: { decrement: request.totalDays } } });
  }

  private async adjustReservedBalance(tx: Prisma.TransactionClient, request: Awaited<ReturnType<LeaveService['ensureRequest']>>, nextTypeId: string, nextYear: number, nextDays: Prisma.Decimal) {
    const [previousType, nextType] = await Promise.all([
      tx.leaveType.findFirst({ where: { id: request.leaveTypeId, deletedAt: null } }),
      tx.leaveType.findFirst({ where: { id: nextTypeId, deletedAt: null } }),
    ]);
    if (!previousType || !nextType) throw new NotFoundException('Leave type not found');
    const previousBalance = previousType.isPaid ? await this.findBalance(request.employeeId, request.leaveTypeId, request.startDate.getUTCFullYear(), tx) : null;
    const nextBalance = nextType.isPaid ? await this.findBalance(request.employeeId, nextTypeId, nextYear, tx) : null;
    if (previousBalance?.pendingDays.lt(request.totalDays)) throw new ConflictException('Leave balance is inconsistent');
    if (previousBalance && nextBalance && previousBalance.id === nextBalance.id) {
      const available = nextBalance.totalDays.minus(nextBalance.usedDays).minus(nextBalance.pendingDays).plus(request.totalDays);
      if (available.lt(nextDays)) throw new BadRequestException('Insufficient leave balance');
      await tx.leaveBalance.update({ where: { id: nextBalance.id }, data: { pendingDays: { increment: nextDays.minus(request.totalDays) } } });
      return;
    }
    if (nextBalance && nextBalance.totalDays.minus(nextBalance.usedDays).minus(nextBalance.pendingDays).lt(nextDays)) throw new BadRequestException('Insufficient leave balance');
    if (previousBalance) await tx.leaveBalance.update({ where: { id: previousBalance.id }, data: { pendingDays: { decrement: request.totalDays } } });
    if (nextBalance) await tx.leaveBalance.update({ where: { id: nextBalance.id }, data: { pendingDays: { increment: nextDays } } });
  }

  private async ensureEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  private async ensureRequest(id: string, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const request = await client.leaveRequest.findFirst({ where: { id, deletedAt: null } });
    if (!request) throw new NotFoundException('Leave request not found');
    return request;
  }

  private async findBalance(employeeId: string, leaveTypeId: string, year: number, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const balance = await client.leaveBalance.findFirst({ where: { employeeId, leaveTypeId, year, deletedAt: null } });
    if (!balance) throw new BadRequestException('Leave balance does not exist for this leave type and year');
    return balance;
  }

  private leaveDate(value: Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  private leaveDuration(startDate: Date, endDate: Date, isHalfDay: boolean) {
    if (endDate < startDate) throw new BadRequestException('endDate must be on or after startDate');
    if (startDate.getUTCFullYear() !== endDate.getUTCFullYear()) throw new BadRequestException('Leave cannot span calendar years');
    if (isHalfDay && endDate.getTime() !== startDate.getTime()) throw new BadRequestException('Half-day leave must use one date');
    return new Prisma.Decimal(isHalfDay ? '0.5' : String(Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1));
  }

  private assertBalanceValues(totalValue: number | Prisma.Decimal, usedValue: number | Prisma.Decimal, pendingValue: number | Prisma.Decimal) {
    const total = new Prisma.Decimal(totalValue); const used = new Prisma.Decimal(usedValue); const pending = new Prisma.Decimal(pendingValue);
    if (total.isNegative() || used.isNegative() || pending.isNegative() || used.plus(pending).gt(total)) throw new BadRequestException('Used and pending leave cannot exceed the total balance');
  }

  private async assertLeavePeriodAvailable(employeeId: string, startDate: Date, endDate: Date, excludeId: string | undefined, tx: Prisma.TransactionClient) {
    const overlap = await tx.leaveRequest.findFirst({
      where: { employeeId, id: excludeId ? { not: excludeId } : undefined, deletedAt: null, status: { in: [...activePendingStatuses, LeaveRequestStatus.APPROVED] }, startDate: { lte: endDate }, endDate: { gte: startDate } }, select: { id: true },
    });
    if (overlap) throw new ConflictException('Leave dates overlap an existing pending or approved request');
  }

  private async assertPayrollIsOpen(employeeId: string, startDate: Date, endDate: Date, tx: Prisma.TransactionClient) {
    const periods: Array<{ year: number; month: number }> = [];
    const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
    const last = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
    while (cursor <= last) { periods.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 }); cursor.setUTCMonth(cursor.getUTCMonth() + 1); }
    const payroll = await tx.payroll.findFirst({ where: { employeeId, OR: periods, payrollRun: { status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PUBLISHED, PayrollRunStatus.PAID] } } }, select: { id: true } });
    if (payroll) throw new BadRequestException('Approved leave cannot be cancelled after payroll approval');
  }

  private async idempotentResult(tx: Prisma.TransactionClient, user: RequestUser, operation: string, key: string | undefined, payload: unknown) {
    this.validateIdempotencyKey(key);
    const hash = this.requestHash(payload);
    const existing = await tx.idempotencyRecord.findUnique({ where: { actorUserId_operation_key: { actorUserId: user.id, operation, key: key! } } });
    if (!existing) return null;
    if (existing.requestHash !== hash) throw new ConflictException('Idempotency key was already used with a different request');
    return tx.leaveRequest.findUniqueOrThrow({ where: { id: existing.resourceId }, include: leaveRequestInclude });
  }

  private saveIdempotency(tx: Prisma.TransactionClient, user: RequestUser, operation: string, key: string | undefined, payload: unknown, resourceId: string) {
    return tx.idempotencyRecord.create({ data: { actorUserId: user.id, operation, key: key!, requestHash: this.requestHash(payload), resourceType: 'LeaveRequest', resourceId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
  }

  private validateIdempotencyKey(key: string | undefined): asserts key is string {
    if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new BadRequestException('A valid Idempotency-Key header is required');
  }

  private requestHash(payload: unknown) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private assertExpectedVersion(actual: number, expected: number) {
    if (actual !== expected) throw new ConflictException('Leave request changed; refresh and retry');
  }

  private async leaveTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error; }
    }
    throw new ConflictException('Leave changed in another request. Try again.');
  }
}

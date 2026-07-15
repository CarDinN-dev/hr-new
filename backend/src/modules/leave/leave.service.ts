import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, LeaveRequestStatus, PayrollStatus, Prisma, Role } from '@prisma/client';
import { hasHrAccess } from '../../common/constants/access.constants';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, listRecords, paginationMeta, softDelete } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLeaveBalanceDto } from './dto/create-leave-balance.dto';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';
import { QueryLeaveBalancesDto } from './dto/query-leave-balances.dto';
import { QueryLeaveRequestsDto } from './dto/query-leave-requests.dto';
import { QueryLeaveTypesDto } from './dto/query-leave-types.dto';
import { UpdateLeaveBalanceDto } from './dto/update-leave-balance.dto';
import { UpdateLeaveRequestDto } from './dto/update-leave-request.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { AuditService } from '../audit/audit.service';

const leaveRequestInclude = {
  employee: {
    select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true, managerId: true },
  },
  leaveType: true,
  manager: { select: { id: true, firstName: true, lastName: true, email: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
};

const leaveBalanceInclude = {
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true, managerId: true } },
  leaveType: true,
};

@Injectable()
export class LeaveService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  createType(dto: CreateLeaveTypeDto) {
    return this.prisma.leaveType.create({ data: dto });
  }

  listTypes(query: QueryLeaveTypesDto) {
    return listRecords(this.prisma.leaveType, query, {
      searchFields: ['name', 'code', 'description'],
      allowedSortFields: ['createdAt', 'name', 'code', 'annualAllowanceDays'],
      defaultSortBy: 'createdAt',
    });
  }

  async findTypeById(id: string) {
    const type = await this.prisma.leaveType.findFirst({ where: { id, deletedAt: null } });
    if (!type) throw new NotFoundException('Leave type not found');
    return type;
  }

  async updateType(id: string, dto: UpdateLeaveTypeDto) {
    await this.findTypeById(id);
    return this.prisma.leaveType.update({ where: { id }, data: dto });
  }

  async removeType(id: string) {
    await this.findTypeById(id);
    const activeBalance = await this.prisma.leaveBalance.findFirst({
      where: { leaveTypeId: id, deletedAt: null },
      select: { id: true },
    });
    if (activeBalance) throw new BadRequestException('Remove active leave balances before deleting this leave type');
    return softDelete(this.prisma.leaveType, id, 'Leave type');
  }

  async createBalance(dto: CreateLeaveBalanceDto) {
    await this.ensureEmployee(dto.employeeId);
    await this.findTypeById(dto.leaveTypeId);
    this.assertBalanceValues(dto.totalDays, dto.usedDays ?? 0, dto.pendingDays ?? 0);
    return this.prisma.leaveBalance.create({ data: dto, include: leaveBalanceInclude });
  }

  async listBalances(query: QueryLeaveBalancesDto, user: RequestUser) {
    const filters: Record<string, unknown>[] = [this.accessWhere(user)];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.leaveTypeId) filters.push({ leaveTypeId: query.leaveTypeId });
    if (query.year) filters.push({ year: query.year });

    const { page, limit, ...args } = listArgs(query, {
      allowedSortFields: ['createdAt', 'year', 'totalDays', 'usedDays', 'pendingDays'],
      defaultSortBy: 'createdAt',
      where: { AND: filters },
      include: leaveBalanceInclude,
    });
    const [data, total] = await Promise.all([
      this.prisma.leaveBalance.findMany(args),
      this.prisma.leaveBalance.count({ where: args.where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findBalanceById(id: string, user: RequestUser) {
    const balance = await this.prisma.leaveBalance.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, this.accessWhere(user)] },
      include: leaveBalanceInclude,
    });
    if (!balance) throw new NotFoundException('Leave balance not found');
    return balance;
  }

  async updateBalance(id: string, dto: UpdateLeaveBalanceDto) {
    return this.leaveTransaction(async (tx) => {
      const balance = await tx.leaveBalance.findFirst({ where: { id, deletedAt: null } });
      if (!balance) throw new NotFoundException('Leave balance not found');
      this.assertBalanceValues(
        dto.totalDays ?? Number(balance.totalDays),
        dto.usedDays ?? Number(balance.usedDays),
        dto.pendingDays ?? Number(balance.pendingDays),
      );
      return tx.leaveBalance.update({ where: { id }, data: dto, include: leaveBalanceInclude });
    });
  }

  async removeBalance(id: string) {
    return this.leaveTransaction(async (tx) => {
      const balance = await tx.leaveBalance.findFirst({ where: { id, deletedAt: null } });
      if (!balance) throw new NotFoundException('Leave balance not found');
      const yearStart = new Date(Date.UTC(balance.year, 0, 1));
      const yearEnd = new Date(Date.UTC(balance.year, 11, 31, 23, 59, 59, 999));
      const activeRequest = await tx.leaveRequest.findFirst({
        where: {
          employeeId: balance.employeeId,
          leaveTypeId: balance.leaveTypeId,
          startDate: { gte: yearStart, lte: yearEnd },
          status: { in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (activeRequest) throw new BadRequestException('Cancel active leave requests before deleting this balance');
      return tx.leaveBalance.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  async createRequest(dto: CreateLeaveRequestDto, user: RequestUser) {
    const employeeId = await this.resolveRequestEmployee(dto.employeeId, user);
    const employee = await this.ensureEmployee(employeeId);
    const leaveType = await this.findTypeById(dto.leaveTypeId);
    const startDate = this.leaveDate(dto.startDate);
    const endDate = this.leaveDate(dto.endDate);
    const totalDays = new Prisma.Decimal(this.leaveDuration(startDate, endDate, dto.isHalfDay ?? false));
    const year = startDate.getUTCFullYear();

    return this.leaveTransaction(async (tx) => {
      await this.assertLeavePeriodAvailable(employeeId, startDate, endDate, undefined, tx);
      if (leaveType.isPaid) {
        const balance = await this.findBalance(employeeId, dto.leaveTypeId, year, tx);
        const available = new Prisma.Decimal(balance.totalDays).minus(balance.usedDays).minus(balance.pendingDays);
        if (available.lt(totalDays)) throw new BadRequestException('Insufficient leave balance');
        await tx.leaveBalance.update({ where: { id: balance.id }, data: { pendingDays: { increment: totalDays } } });
      }
      const request = await tx.leaveRequest.create({
        data: {
          employeeId,
          leaveTypeId: dto.leaveTypeId,
          startDate,
          endDate,
          totalDays,
          isHalfDay: dto.isHalfDay ?? false,
          reason: dto.reason,
          managerId: employee.managerId,
        },
        include: leaveRequestInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'LeaveRequest', entityId: request.id, summary: 'Leave request submitted' });
      return request;
    });
  }

  async listRequests(query: QueryLeaveRequestsDto, user: RequestUser) {
    const filters = this.requestFilters(query, user);
    const { page, limit, ...args } = listArgs(query, {
      allowedSortFields: ['createdAt', 'startDate', 'endDate', 'totalDays', 'status'],
      defaultSortBy: 'createdAt',
      where: { AND: filters },
      include: leaveRequestInclude,
    });
    const [data, total] = await Promise.all([
      this.prisma.leaveRequest.findMany(args),
      this.prisma.leaveRequest.count({ where: args.where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findRequestById(id: string, user: RequestUser) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, this.accessWhere(user)] },
      include: leaveRequestInclude,
    });
    if (!request) throw new NotFoundException('Leave request not found');
    return request;
  }

  async history(employeeId: string, query: QueryLeaveRequestsDto, user: RequestUser) {
    await this.assertCanAccessEmployee(employeeId, user);
    return this.listRequests({ ...query, employeeId }, user);
  }

  async updateRequest(id: string, dto: UpdateLeaveRequestDto, user: RequestUser) {
    return this.leaveTransaction(async (tx) => {
      const request = await this.ensureRequest(id, tx);
      await this.assertCanCancel(request.employeeId, user);
      if (request.status !== LeaveRequestStatus.PENDING) {
        throw new BadRequestException('Only pending leave requests can be updated');
      }

      const nextLeaveTypeId = dto.leaveTypeId ?? request.leaveTypeId;
      const nextStartDate = this.leaveDate(dto.startDate ?? request.startDate);
      const nextEndDate = this.leaveDate(dto.endDate ?? request.endDate);
      const nextIsHalfDay = dto.isHalfDay ?? request.isHalfDay;
      const nextTotalDays = new Prisma.Decimal(this.leaveDuration(nextStartDate, nextEndDate, nextIsHalfDay));
      await this.assertLeavePeriodAvailable(request.employeeId, nextStartDate, nextEndDate, id, tx);
      const previousYear = request.startDate.getUTCFullYear();
      const nextYear = nextStartDate.getUTCFullYear();
      const previousTotalDays = new Prisma.Decimal(request.totalDays);
      const [previousType, nextType] = await Promise.all([
        tx.leaveType.findFirst({ where: { id: request.leaveTypeId, deletedAt: null } }),
        tx.leaveType.findFirst({ where: { id: nextLeaveTypeId, deletedAt: null } }),
      ]);
      if (!previousType || !nextType) throw new NotFoundException('Leave type not found');
      const previousBalance = previousType.isPaid ? await this.findBalance(request.employeeId, request.leaveTypeId, previousYear, tx) : null;
      const nextBalance = nextType.isPaid ? await this.findBalance(request.employeeId, nextLeaveTypeId, nextYear, tx) : null;
      const sameBalance = Boolean(previousBalance && nextBalance && previousBalance.id === nextBalance.id);
      if (previousBalance && new Prisma.Decimal(previousBalance.pendingDays).lt(previousTotalDays)) {
        throw new ConflictException('Leave balance is inconsistent. Reconcile the balance before updating this request.');
      }
      if (nextBalance) {
        const available = new Prisma.Decimal(nextBalance.totalDays).minus(nextBalance.usedDays).minus(nextBalance.pendingDays).plus(sameBalance ? previousTotalDays : 0);
        if (available.lt(nextTotalDays)) throw new BadRequestException('Insufficient leave balance');
      }

      if (sameBalance && previousBalance) {
        const pendingDelta = nextTotalDays.minus(previousTotalDays);
        if (!pendingDelta.isZero()) {
          await tx.leaveBalance.update({
            where: { id: previousBalance.id },
            data: { pendingDays: { increment: pendingDelta } },
          });
        }
      } else {
        if (previousBalance) {
        await tx.leaveBalance.update({
          where: { id: previousBalance.id },
          data: { pendingDays: { decrement: previousTotalDays } },
        });
        }
        if (nextBalance) {
        await tx.leaveBalance.update({
          where: { id: nextBalance.id },
          data: { pendingDays: { increment: nextTotalDays } },
        });
        }
      }

      const updated = await tx.leaveRequest.update({
        where: { id },
        data: {
          leaveTypeId: nextLeaveTypeId,
          startDate: nextStartDate,
          endDate: nextEndDate,
          totalDays: nextTotalDays,
          isHalfDay: nextIsHalfDay,
          reason: dto.reason,
        },
        include: leaveRequestInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'LeaveRequest', entityId: id, summary: 'Leave request updated' });
      return updated;
    });
  }

  async decideRequest(id: string, dto: DecideLeaveRequestDto, user: RequestUser) {
    const decisionStatuses: LeaveRequestStatus[] = [
      LeaveRequestStatus.APPROVED,
      LeaveRequestStatus.REJECTED,
    ];
    if (!decisionStatuses.includes(dto.status)) {
      throw new BadRequestException('Decision must be APPROVED or REJECTED');
    }

    return this.leaveTransaction(async (tx) => {
      const request = await this.ensureRequest(id, tx);
      if (request.status !== LeaveRequestStatus.PENDING) {
        throw new BadRequestException('Only pending leave requests can be approved or rejected');
      }
      await this.assertCanApprove(request.employeeId, user, tx);

      const leaveType = await tx.leaveType.findFirst({ where: { id: request.leaveTypeId, deletedAt: null } });
      if (!leaveType) throw new NotFoundException('Leave type not found');
      if (leaveType.isPaid) {
        const year = request.startDate.getUTCFullYear();
        const balance = await this.findBalance(request.employeeId, request.leaveTypeId, year, tx);
        const totalDays = new Prisma.Decimal(request.totalDays);
        if (new Prisma.Decimal(balance.pendingDays).lt(totalDays)) {
          throw new ConflictException('Leave balance is inconsistent. Reconcile the balance before deciding this request.');
        }
        const balanceUpdate = dto.status === LeaveRequestStatus.APPROVED
          ? { pendingDays: { decrement: totalDays }, usedDays: { increment: totalDays } }
          : { pendingDays: { decrement: totalDays } };
        await tx.leaveBalance.update({ where: { id: balance.id }, data: balanceUpdate });
      }
      const updated = await tx.leaveRequest.update({
        where: { id },
        data: {
          status: dto.status,
          rejectionReason: dto.status === LeaveRequestStatus.REJECTED ? dto.rejectionReason : null,
          approvedById: user.employeeId ?? null,
          approvedAt: new Date(),
        },
        include: leaveRequestInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, entityType: 'LeaveRequest', entityId: id, summary: 'Leave request decided', changes: [{ field: 'status', previousValue: request.status, nextValue: dto.status }] });
      return updated;
    });
  }

  async cancelRequest(id: string, user: RequestUser) {
    return this.leaveTransaction(async (tx) => {
      const request = await this.ensureRequest(id, tx);
      await this.assertCanCancel(request.employeeId, user);
      const cancellableStatuses: LeaveRequestStatus[] = [
        LeaveRequestStatus.PENDING,
        LeaveRequestStatus.APPROVED,
      ];
      if (!cancellableStatuses.includes(request.status)) {
        throw new BadRequestException('Only pending or approved leave requests can be cancelled');
      }
      if (request.status === LeaveRequestStatus.APPROVED) {
        await this.assertPayrollIsOpen(request.employeeId, request.startDate, request.endDate, tx);
      }

      const leaveType = await tx.leaveType.findFirst({ where: { id: request.leaveTypeId, deletedAt: null } });
      if (!leaveType) throw new NotFoundException('Leave type not found');
      if (leaveType.isPaid) {
        const year = request.startDate.getUTCFullYear();
        const balance = await this.findBalance(request.employeeId, request.leaveTypeId, year, tx);
        const totalDays = new Prisma.Decimal(request.totalDays);
        const balanceField = request.status === LeaveRequestStatus.APPROVED ? balance.usedDays : balance.pendingDays;
        if (new Prisma.Decimal(balanceField).lt(totalDays)) {
          throw new ConflictException('Leave balance is inconsistent. Reconcile the balance before cancelling this request.');
        }
        const balanceUpdate = request.status === LeaveRequestStatus.APPROVED
          ? { usedDays: { decrement: totalDays } }
          : { pendingDays: { decrement: totalDays } };
        await tx.leaveBalance.update({ where: { id: balance.id }, data: balanceUpdate });
      }
      const cancelled = await tx.leaveRequest.update({
        where: { id },
        data: { status: LeaveRequestStatus.CANCELLED },
        include: leaveRequestInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, entityType: 'LeaveRequest', entityId: id, summary: 'Leave request cancelled', changes: [{ field: 'status', previousValue: request.status, nextValue: LeaveRequestStatus.CANCELLED }] });
      return cancelled;
    });
  }

  async removeRequest(id: string, user: RequestUser) {
    return this.leaveTransaction(async (tx) => {
      const request = await this.ensureRequest(id, tx);
      if (request.status === LeaveRequestStatus.PENDING || request.status === LeaveRequestStatus.APPROVED) {
        throw new BadRequestException('Cancel pending or approved leave before deleting it');
      }
      const removed = await tx.leaveRequest.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'LeaveRequest', entityId: id, summary: 'Leave request archived' });
      return removed;
    });
  }

  private requestFilters(query: QueryLeaveRequestsDto, user: RequestUser) {
    const filters: Record<string, unknown>[] = [this.accessWhere(user)];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.leaveTypeId) filters.push({ leaveTypeId: query.leaveTypeId });
    if (query.status) filters.push({ status: query.status });
    if (query.dateFrom) filters.push({ endDate: { gte: query.dateFrom } });
    if (query.dateTo) filters.push({ startDate: { lte: query.dateTo } });
    return filters;
  }

  private accessWhere(user: RequestUser): Record<string, unknown> {
    if (hasHrAccess(user.role)) return {};
    if (!user.employeeId) return { employeeId: '__no_employee_profile__' };
    if (user.role === Role.MANAGER) {
      return { OR: [{ employeeId: user.employeeId }, { employee: { managerId: user.employeeId } }] };
    }
    return { employeeId: user.employeeId };
  }

  private async resolveRequestEmployee(employeeId: string | undefined, user: RequestUser) {
    const targetEmployeeId = employeeId ?? user.employeeId;
    if (!targetEmployeeId) throw new NotFoundException('No employee profile is linked to this user');
    if (employeeId && !hasHrAccess(user.role)) {
      throw new ForbiddenException('Only HR can submit leave for another employee');
    }
    return targetEmployeeId;
  }

  private async assertCanAccessEmployee(employeeId: string, user: RequestUser) {
    if (hasHrAccess(user.role)) return;
    if (!user.employeeId) throw new ForbiddenException('Employee profile is required');
    if (employeeId === user.employeeId) return;
    if (user.role === Role.MANAGER) {
      const employee = await this.prisma.employee.findFirst({
        where: { id: employeeId, managerId: user.employeeId, deletedAt: null },
      });
      if (employee) return;
    }
    throw new ForbiddenException('Cannot access leave history for this employee');
  }

  private async assertCanApprove(
    employeeId: string,
    user: RequestUser,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    if (hasHrAccess(user.role)) return;
    if (!user.employeeId || user.role !== Role.MANAGER) {
      throw new ForbiddenException('Only managers or HR can approve leave requests');
    }
    const employee = await client.employee.findFirst({
      where: { id: employeeId, managerId: user.employeeId, deletedAt: null },
    });
    if (!employee) throw new ForbiddenException('Managers can only approve direct reports');
  }

  private async assertCanCancel(employeeId: string, user: RequestUser) {
    if (hasHrAccess(user.role) || employeeId === user.employeeId) return;
    throw new ForbiddenException('Cannot cancel another employee leave request');
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

  private async findBalance(
    employeeId: string,
    leaveTypeId: string,
    year: number,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const balance = await client.leaveBalance.findFirst({
      where: { employeeId, leaveTypeId, year, deletedAt: null },
    });
    if (!balance) throw new BadRequestException('Leave balance does not exist for this leave type and year');
    return balance;
  }

  private leaveDate(value: Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  private leaveDuration(startDate: Date, endDate: Date, isHalfDay: boolean) {
    const start = startDate.getTime();
    const end = endDate.getTime();
    if (end < start) throw new BadRequestException('endDate must be on or after startDate');
    if (startDate.getUTCFullYear() !== endDate.getUTCFullYear()) {
      throw new BadRequestException('Leave cannot span calendar years. Submit one request for each year.');
    }
    if (isHalfDay && end !== start) {
      throw new BadRequestException('Half-day leave must start and end on the same date');
    }
    return isHalfDay ? 0.5 : Math.floor((end - start) / 86_400_000) + 1;
  }

  private assertBalanceValues(totalDays: number, usedDays: number, pendingDays: number) {
    if (usedDays + pendingDays > totalDays) {
      throw new BadRequestException('Used and pending leave cannot exceed the total balance');
    }
  }

  private async assertLeavePeriodAvailable(
    employeeId: string,
    startDate: Date,
    endDate: Date,
    excludeId: string | undefined,
    tx: Prisma.TransactionClient,
  ) {
    const overlap = await tx.leaveRequest.findFirst({
      where: {
        employeeId,
        id: excludeId ? { not: excludeId } : undefined,
        deletedAt: null,
        status: { in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { id: true },
    });
    if (overlap) throw new ConflictException('Leave dates overlap an existing pending or approved request');
  }

  private async assertPayrollIsOpen(
    employeeId: string,
    startDate: Date,
    endDate: Date,
    tx: Prisma.TransactionClient,
  ) {
    const periods: Array<{ year: number; month: number }> = [];
    const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
    const last = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
    while (cursor <= last) {
      periods.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    const finalizedPayroll = await tx.payroll.findFirst({
      where: {
        employeeId,
        deletedAt: null,
        status: { in: [PayrollStatus.APPROVED, PayrollStatus.PAID] },
        OR: periods,
      },
      select: { id: true },
    });
    if (finalizedPayroll) {
      throw new BadRequestException('Approved leave cannot be cancelled after payroll is approved or paid');
    }
  }

  private async leaveTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      }
    }
    throw new ConflictException('Leave changed in another request. Try again.');
  }
}

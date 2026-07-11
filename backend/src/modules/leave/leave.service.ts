import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveRequestStatus, Role } from '@prisma/client';
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
  constructor(private readonly prisma: PrismaService) {}

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
    return softDelete(this.prisma.leaveType, id, 'Leave type');
  }

  async createBalance(dto: CreateLeaveBalanceDto) {
    await this.ensureEmployee(dto.employeeId);
    await this.findTypeById(dto.leaveTypeId);
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
    await this.prisma.leaveBalance.findFirstOrThrow({ where: { id, deletedAt: null } }).catch(() => {
      throw new NotFoundException('Leave balance not found');
    });
    return this.prisma.leaveBalance.update({ where: { id }, data: dto, include: leaveBalanceInclude });
  }

  async removeBalance(id: string) {
    await this.prisma.leaveBalance.findFirstOrThrow({ where: { id, deletedAt: null } }).catch(() => {
      throw new NotFoundException('Leave balance not found');
    });
    return softDelete(this.prisma.leaveBalance, id, 'Leave balance');
  }

  async createRequest(dto: CreateLeaveRequestDto, user: RequestUser) {
    const employeeId = await this.resolveRequestEmployee(dto.employeeId, user);
    const employee = await this.ensureEmployee(employeeId);
    await this.findTypeById(dto.leaveTypeId);

    if (dto.endDate < dto.startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const year = dto.startDate.getFullYear();
    const balance = await this.findBalance(employeeId, dto.leaveTypeId, year);
    const available = Number(balance.totalDays) - Number(balance.usedDays) - Number(balance.pendingDays);
    if (available < dto.totalDays) {
      throw new BadRequestException('Insufficient leave balance');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.leaveBalance.update({
        where: { id: balance.id },
        data: { pendingDays: { increment: dto.totalDays } },
      });
      return tx.leaveRequest.create({
        data: {
          employeeId,
          leaveTypeId: dto.leaveTypeId,
          startDate: dto.startDate,
          endDate: dto.endDate,
          totalDays: dto.totalDays,
          reason: dto.reason,
          managerId: employee.managerId,
        },
        include: leaveRequestInclude,
      });
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
    const request = await this.ensureRequest(id);
    await this.assertCanCancel(request.employeeId, user);
    if (request.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException('Only pending leave requests can be updated');
    }
    return this.prisma.leaveRequest.update({
      where: { id },
      data: dto,
      include: leaveRequestInclude,
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

    const request = await this.ensureRequest(id);
    if (request.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException('Only pending leave requests can be approved or rejected');
    }
    await this.assertCanApprove(request.employeeId, user);

    const year = request.startDate.getFullYear();
    const balance = await this.findBalance(request.employeeId, request.leaveTypeId, year);
    const totalDays = Number(request.totalDays);

    return this.prisma.$transaction(async (tx) => {
      const balanceUpdate =
        dto.status === LeaveRequestStatus.APPROVED
          ? { pendingDays: { decrement: totalDays }, usedDays: { increment: totalDays } }
          : { pendingDays: { decrement: totalDays } };

      await tx.leaveBalance.update({ where: { id: balance.id }, data: balanceUpdate });
      return tx.leaveRequest.update({
        where: { id },
        data: {
          status: dto.status,
          rejectionReason: dto.status === LeaveRequestStatus.REJECTED ? dto.rejectionReason : null,
          approvedById: user.employeeId ?? null,
          approvedAt: new Date(),
        },
        include: leaveRequestInclude,
      });
    });
  }

  async cancelRequest(id: string, user: RequestUser) {
    const request = await this.ensureRequest(id);
    await this.assertCanCancel(request.employeeId, user);
    const cancellableStatuses: LeaveRequestStatus[] = [
      LeaveRequestStatus.PENDING,
      LeaveRequestStatus.APPROVED,
    ];
    if (!cancellableStatuses.includes(request.status)) {
      throw new BadRequestException('Only pending or approved leave requests can be cancelled');
    }

    const year = request.startDate.getFullYear();
    const balance = await this.findBalance(request.employeeId, request.leaveTypeId, year);
    const totalDays = Number(request.totalDays);
    const balanceUpdate =
      request.status === LeaveRequestStatus.APPROVED
        ? { usedDays: { decrement: totalDays } }
        : { pendingDays: { decrement: totalDays } };

    return this.prisma.$transaction(async (tx) => {
      await tx.leaveBalance.update({ where: { id: balance.id }, data: balanceUpdate });
      return tx.leaveRequest.update({
        where: { id },
        data: { status: LeaveRequestStatus.CANCELLED },
        include: leaveRequestInclude,
      });
    });
  }

  async removeRequest(id: string) {
    await this.ensureRequest(id);
    return softDelete(this.prisma.leaveRequest, id, 'Leave request');
  }

  private requestFilters(query: QueryLeaveRequestsDto, user: RequestUser) {
    const filters: Record<string, unknown>[] = [this.accessWhere(user)];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.leaveTypeId) filters.push({ leaveTypeId: query.leaveTypeId });
    if (query.status) filters.push({ status: query.status });
    if (query.dateFrom || query.dateTo) {
      filters.push({
        startDate: {
          gte: query.dateFrom,
          lte: query.dateTo,
        },
      });
    }
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

  private async assertCanApprove(employeeId: string, user: RequestUser) {
    if (hasHrAccess(user.role)) return;
    if (!user.employeeId || user.role !== Role.MANAGER) {
      throw new ForbiddenException('Only managers or HR can approve leave requests');
    }
    const employee = await this.prisma.employee.findFirst({
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

  private async ensureRequest(id: string) {
    const request = await this.prisma.leaveRequest.findFirst({ where: { id, deletedAt: null } });
    if (!request) throw new NotFoundException('Leave request not found');
    return request;
  }

  private async findBalance(employeeId: string, leaveTypeId: string, year: number) {
    const balance = await this.prisma.leaveBalance.findFirst({
      where: { employeeId, leaveTypeId, year, deletedAt: null },
    });
    if (!balance) throw new BadRequestException('Leave balance does not exist for this leave type and year');
    return balance;
  }
}

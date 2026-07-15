import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, PayrollStatus, Prisma, Role } from '@prisma/client';
import { hasHrAccess, hasManagementAccess } from '../../common/constants/access.constants';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckAttendanceDto } from './dto/check-attendance.dto';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

const attendanceInclude = {
  employee: {
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      email: true,
      departmentId: true,
      managerId: true,
    },
  },
};

@Injectable()
export class AttendanceService {
  private readonly companyTimeZone = 'Asia/Qatar';

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAttendanceDto) {
    await this.ensureEmployee(dto.employeeId);
    const attendanceDate = this.dayStart(dto.attendanceDate);
    return this.attendanceTransaction(async (tx) => {
      await this.assertPayrollIsOpen(dto.employeeId, attendanceDate, tx);
      const existing = await tx.attendance.findUnique({
        where: { employeeId_attendanceDate: { employeeId: dto.employeeId, attendanceDate } },
      });
      if (existing && !existing.deletedAt) {
        throw new ConflictException('Attendance already exists for this employee and date');
      }
      const data = this.manualAttendanceData(dto, attendanceDate);
      return existing
        ? tx.attendance.update({ where: { id: existing.id }, data: { ...data, deletedAt: null }, include: attendanceInclude })
        : tx.attendance.create({ data, include: attendanceInclude });
    });
  }

  async list(query: QueryAttendanceDto, user: RequestUser) {
    const filters = this.buildFilters(query, user);
    const { page, limit, ...args } = listArgs(query, {
      allowedSortFields: ['createdAt', 'attendanceDate', 'checkIn', 'checkOut', 'workingHours', 'status'],
      defaultSortBy: 'attendanceDate',
      where: { AND: filters },
      include: attendanceInclude,
    });

    const [data, total] = await Promise.all([
      this.prisma.attendance.findMany(args),
      this.prisma.attendance.count({ where: args.where }),
    ]);

    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findById(id: string, user: RequestUser) {
    const record = await this.prisma.attendance.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, this.accessWhere(user)] },
      include: attendanceInclude,
    });
    if (!record) throw new NotFoundException('Attendance record not found');
    return record;
  }

  async update(id: string, dto: UpdateAttendanceDto) {
    if (dto.employeeId) await this.ensureEmployee(dto.employeeId);
    return this.attendanceTransaction(async (tx) => {
      const record = await this.ensureExists(id, tx);
      const employeeId = dto.employeeId ?? record.employeeId;
      const attendanceDate = this.dayStart(dto.attendanceDate ?? record.attendanceDate);
      await this.assertPayrollIsOpen(record.employeeId, record.attendanceDate, tx);
      await this.assertPayrollIsOpen(employeeId, attendanceDate, tx);
      const data = this.manualAttendanceData(
        {
          employeeId,
          attendanceDate,
          checkIn: dto.checkIn ?? record.checkIn ?? undefined,
          checkOut: dto.checkOut ?? record.checkOut ?? undefined,
          status: dto.status ?? record.status,
          notes: dto.notes ?? record.notes ?? undefined,
        },
        attendanceDate,
      );
      return tx.attendance.update({ where: { id }, data, include: attendanceInclude });
    });
  }

  async remove(id: string) {
    return this.attendanceTransaction(async (tx) => {
      const record = await this.ensureExists(id, tx);
      await this.assertPayrollIsOpen(record.employeeId, record.attendanceDate, tx);
      return tx.attendance.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  async checkIn(dto: CheckAttendanceDto, user: RequestUser) {
    const employeeId = await this.resolveSelfOrHrEmployee(dto.employeeId, user);
    const now = new Date();
    const attendanceDate = this.companyDay(now);
    return this.attendanceTransaction(async (tx) => {
      await this.assertPayrollIsOpen(employeeId, attendanceDate, tx);
      const existing = await tx.attendance.findUnique({
        where: { employeeId_attendanceDate: { employeeId, attendanceDate } },
      });
      if (existing?.checkIn && !existing.deletedAt) {
        throw new BadRequestException('Employee is already checked in for today');
      }

      const lateMinutes = this.lateMinutes(now);
      const data = {
        employeeId,
        attendanceDate,
        checkIn: now,
        checkOut: null,
        workingHours: 0,
        isLate: lateMinutes > 0,
        lateMinutes,
        status: lateMinutes > 0 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
        deletedAt: null,
      };
      return existing
        ? tx.attendance.update({ where: { id: existing.id }, data, include: attendanceInclude })
        : tx.attendance.create({ data, include: attendanceInclude });
    });
  }

  async checkOut(dto: CheckAttendanceDto, user: RequestUser) {
    const employeeId = await this.resolveSelfOrHrEmployee(dto.employeeId, user);
    const now = new Date();
    const attendanceDate = this.companyDay(now);
    return this.attendanceTransaction(async (tx) => {
      await this.assertPayrollIsOpen(employeeId, attendanceDate, tx);
      const record = await tx.attendance.findUnique({
        where: { employeeId_attendanceDate: { employeeId, attendanceDate } },
      });
      if (!record?.checkIn || record.deletedAt) {
        throw new BadRequestException('Employee must check in before checking out');
      }
      if (record.checkOut) {
        throw new BadRequestException('Employee is already checked out for today');
      }

      const workingHours = Number(((now.getTime() - record.checkIn.getTime()) / 36e5).toFixed(2));
      if (workingHours < 0 || workingHours > 48) {
        throw new BadRequestException('Attendance duration must be between 0 and 48 hours');
      }
      return tx.attendance.update({
        where: { id: record.id },
        data: { checkOut: now, workingHours },
        include: attendanceInclude,
      });
    });
  }

  async report(query: QueryAttendanceDto, user: RequestUser) {
    if (!hasManagementAccess(user.role)) {
      throw new ForbiddenException('Only managers and HR can access attendance reports');
    }

    const { page, limit, ...args } = listArgs(query, {
      allowedSortFields: ['createdAt', 'attendanceDate', 'checkIn', 'checkOut', 'workingHours', 'status'],
      defaultSortBy: 'attendanceDate',
      where: { AND: this.buildFilters(query, user) },
      include: attendanceInclude,
    });
    const [records, totals, lateRecords, statuses] = await Promise.all([
      this.prisma.attendance.findMany(args),
      this.prisma.attendance.aggregate({
        where: args.where,
        _count: { _all: true },
        _sum: { workingHours: true },
      }),
      this.prisma.attendance.count({ where: { AND: [args.where, { isLate: true }] } }),
      this.prisma.attendance.groupBy({
        by: ['status'],
        where: args.where,
        _count: { _all: true },
      }),
    ]);
    const totalRecords = totals._count._all;

    return {
      data: {
        summary: {
          totalRecords,
          lateRecords,
          totalWorkingHours: Number(Number(totals._sum.workingHours ?? 0).toFixed(2)),
          byStatus: Object.fromEntries(statuses.map((status) => [status.status, status._count._all])),
        },
        records,
      },
      meta: paginationMeta(totalRecords, page, limit),
    };
  }

  private buildFilters(query: QueryAttendanceDto, user: RequestUser) {
    const filters: Record<string, unknown>[] = [this.accessWhere(user)];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.departmentId) filters.push({ employee: { departmentId: query.departmentId } });
    if (query.status) filters.push({ status: query.status });
    if (query.dateFrom || query.dateTo) {
      filters.push({
        attendanceDate: {
          gte: query.dateFrom ? this.dayStart(query.dateFrom) : undefined,
          lte: query.dateTo ? this.dayEnd(query.dateTo) : undefined,
        },
      });
    }
    return filters;
  }

  private accessWhere(user: RequestUser) {
    if (hasHrAccess(user.role)) return {};
    if (!user.employeeId) return { employeeId: '__no_employee_profile__' };
    if (user.role === Role.MANAGER) {
      return { OR: [{ employeeId: user.employeeId }, { employee: { managerId: user.employeeId } }] };
    }
    return { employeeId: user.employeeId };
  }

  private async resolveSelfOrHrEmployee(employeeId: string | undefined, user: RequestUser) {
    const targetEmployeeId = employeeId ?? user.employeeId;
    if (!targetEmployeeId) throw new NotFoundException('No employee profile is linked to this user');
    if (employeeId && !hasHrAccess(user.role)) {
      throw new ForbiddenException('Only HR can check attendance for another employee');
    }
    await this.ensureEmployee(targetEmployeeId);
    return targetEmployeeId;
  }

  private async ensureEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!employee) throw new NotFoundException('Employee not found');
  }

  private async ensureExists(id: string, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const record = await client.attendance.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Attendance record not found');
    return record;
  }

  private dayStart(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private dayEnd(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  }

  private lateMinutes(date: Date) {
    const parts = this.companyDateParts(date);
    return Math.max(0, parts.hour * 60 + parts.minute - 9 * 60);
  }

  private companyDay(date: Date) {
    const parts = this.companyDateParts(date);
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  }

  private companyDateParts(date: Date) {
    const values = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.companyTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(values.find((value) => value.type === type)?.value);
    return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute') };
  }

  private manualAttendanceData(dto: CreateAttendanceDto, attendanceDate: Date) {
    if (dto.checkOut && !dto.checkIn) throw new BadRequestException('checkIn is required when checkOut is supplied');
    if (dto.checkIn && dto.checkOut && dto.checkOut < dto.checkIn) {
      throw new BadRequestException('checkOut must be on or after checkIn');
    }
    const lateMinutes = dto.checkIn ? this.lateMinutes(dto.checkIn) : 0;
    const workingHours = dto.checkIn && dto.checkOut
      ? Number(((dto.checkOut.getTime() - dto.checkIn.getTime()) / 36e5).toFixed(2))
      : 0;
    if (workingHours > 48) throw new BadRequestException('Attendance duration cannot exceed 48 hours');
    return {
      employeeId: dto.employeeId,
      attendanceDate,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
      notes: dto.notes,
      isLate: lateMinutes > 0,
      lateMinutes,
      workingHours,
      status: dto.status ?? (lateMinutes > 0 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT),
    };
  }

  private async assertPayrollIsOpen(employeeId: string, attendanceDate: Date, tx: Prisma.TransactionClient) {
    const payroll = await tx.payroll.findFirst({
      where: {
        employeeId,
        year: attendanceDate.getUTCFullYear(),
        month: attendanceDate.getUTCMonth() + 1,
        deletedAt: null,
        status: { in: [PayrollStatus.APPROVED, PayrollStatus.PAID] },
      },
      select: { id: true },
    });
    if (payroll) throw new BadRequestException('Attendance cannot change after payroll is approved or paid');
  }

  private async attendanceTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      }
    }
    throw new ConflictException('Attendance changed in another request. Try again.');
  }
}

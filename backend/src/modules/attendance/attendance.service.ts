import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, Role } from '@prisma/client';
import { hasHrAccess, hasManagementAccess } from '../../common/constants/access.constants';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta, softDelete } from '../../common/utils/crud.util';
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
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAttendanceDto) {
    await this.ensureEmployee(dto.employeeId);
    return this.prisma.attendance.create({
      data: { ...dto, attendanceDate: this.dayStart(dto.attendanceDate) },
      include: attendanceInclude,
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
    await this.ensureExists(id);
    if (dto.employeeId) await this.ensureEmployee(dto.employeeId);
    return this.prisma.attendance.update({
      where: { id },
      data: {
        ...dto,
        attendanceDate: dto.attendanceDate ? this.dayStart(dto.attendanceDate) : undefined,
      },
      include: attendanceInclude,
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return softDelete(this.prisma.attendance, id, 'Attendance record');
  }

  async checkIn(dto: CheckAttendanceDto, user: RequestUser) {
    const employeeId = await this.resolveSelfOrHrEmployee(dto.employeeId, user);
    const now = new Date();
    const attendanceDate = this.dayStart(now);
    const existing = await this.prisma.attendance.findFirst({
      where: { employeeId, attendanceDate, deletedAt: null },
    });

    if (existing?.checkIn) {
      throw new BadRequestException('Employee is already checked in for today');
    }

    const lateMinutes = this.lateMinutes(now);
    const data = {
      employeeId,
      attendanceDate,
      checkIn: now,
      isLate: lateMinutes > 0,
      lateMinutes,
      status: lateMinutes > 0 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
    };

    if (existing) {
      return this.prisma.attendance.update({
        where: { id: existing.id },
        data,
        include: attendanceInclude,
      });
    }

    return this.prisma.attendance.create({ data, include: attendanceInclude });
  }

  async checkOut(dto: CheckAttendanceDto, user: RequestUser) {
    const employeeId = await this.resolveSelfOrHrEmployee(dto.employeeId, user);
    const now = new Date();
    const attendanceDate = this.dayStart(now);
    const record = await this.prisma.attendance.findFirst({
      where: { employeeId, attendanceDate, deletedAt: null },
    });

    if (!record?.checkIn) {
      throw new BadRequestException('Employee must check in before checking out');
    }
    if (record.checkOut) {
      throw new BadRequestException('Employee is already checked out for today');
    }

    const workingHours = Number(((now.getTime() - record.checkIn.getTime()) / 36e5).toFixed(2));
    return this.prisma.attendance.update({
      where: { id: record.id },
      data: { checkOut: now, workingHours },
      include: attendanceInclude,
    });
  }

  async report(query: QueryAttendanceDto, user: RequestUser) {
    if (!hasManagementAccess(user.role)) {
      throw new ForbiddenException('Only managers and HR can access attendance reports');
    }

    const filters = this.buildFilters(query, user);
    const records = await this.prisma.attendance.findMany({
      where: { AND: filters },
      include: attendanceInclude,
      orderBy: { attendanceDate: 'asc' },
    });

    const summary = records.reduce(
      (acc, record) => {
        acc.totalRecords += 1;
        acc.totalWorkingHours += Number(record.workingHours);
        acc.byStatus[record.status] = (acc.byStatus[record.status] ?? 0) + 1;
        if (record.isLate) acc.lateRecords += 1;
        return acc;
      },
      {
        totalRecords: 0,
        lateRecords: 0,
        totalWorkingHours: 0,
        byStatus: {} as Record<string, number>,
      },
    );

    return {
      data: {
        summary: {
          ...summary,
          totalWorkingHours: Number(summary.totalWorkingHours.toFixed(2)),
        },
        records,
      },
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

  private async ensureExists(id: string) {
    const record = await this.prisma.attendance.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Attendance record not found');
  }

  private dayStart(date: Date) {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    return value;
  }

  private dayEnd(date: Date) {
    const value = new Date(date);
    value.setHours(23, 59, 59, 999);
    return value;
  }

  private lateMinutes(date: Date) {
    const expected = new Date(date);
    expected.setHours(9, 0, 0, 0);
    return Math.max(0, Math.floor((date.getTime() - expected.getTime()) / 60000));
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessScopeType, AttendanceApprovalStatus, AttendanceStatus, AuditAction, PayrollRunStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckAttendanceDto } from './dto/check-attendance.dto';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { ImportAttendanceDto } from './dto/import-attendance.dto';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(dto: CreateAttendanceDto, user: RequestUser) {
    await this.authorization.assertEmployeeScope(user, dto.employeeId, { all: 'attendance.hr.manage' });
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
      const created = existing
        ? tx.attendance.update({ where: { id: existing.id }, data: { ...data, deletedAt: null }, include: attendanceInclude })
        : tx.attendance.create({ data, include: attendanceInclude });
      const attendance = await created;
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'Attendance', entityId: attendance.id, summary: 'Attendance recorded' });
      return attendance;
    });
  }

  async importAttendance(dto: ImportAttendanceDto, user: RequestUser) {
    if (!this.authorization.permissionAllowedForScope(user, 'import.run', AccessScopeType.ALL_SYSTEM)) throw new ForbiddenException('Insufficient permission');
    const prepared = dto.rows.map((row) => this.manualAttendanceData(row, this.dayStart(row.attendanceDate)));
    const keys = new Set<string>();
    for (const row of prepared) {
      const key = `${row.employeeId}:${row.attendanceDate.toISOString().slice(0, 10)}`;
      if (keys.has(key)) throw new BadRequestException(`Duplicate attendance row for ${key}`);
      keys.add(key);
    }
    const employeeIds = [...new Set(prepared.map((row) => row.employeeId))];
    for (const employeeId of employeeIds) {
      if (!this.authorization.permissionAllowedForScope(user, 'attendance.hr.manage', AccessScopeType.ALL_EMPLOYEES, employeeId)) throw new NotFoundException('Employee not found');
    }
    const employees = await this.prisma.employee.findMany({ where: { id: { in: employeeIds }, deletedAt: null }, select: { id: true } });
    if (employees.length !== employeeIds.length) throw new NotFoundException('One or more employees were not found');
    const years = [...new Set(prepared.map((row) => row.attendanceDate.getUTCFullYear()))];
    const closedPayrolls = await this.prisma.payroll.findMany({
      where: { employeeId: { in: employeeIds }, year: { in: years }, payrollRun: { status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PUBLISHED, PayrollRunStatus.PAID] } } },
      select: { employeeId: true, year: true, month: true },
    });
    const closedKeys = new Set(closedPayrolls.map((payroll) => `${payroll.employeeId}:${payroll.year}:${payroll.month}`));
    const blocked = prepared.find((row) => closedKeys.has(`${row.employeeId}:${row.attendanceDate.getUTCFullYear()}:${row.attendanceDate.getUTCMonth() + 1}`));
    if (blocked) throw new BadRequestException('Attendance cannot change after payroll is approved or paid');

    return this.attendanceTransaction(async (tx) => {
      for (let offset = 0; offset < prepared.length; offset += 2_000) {
        const chunk = prepared.slice(offset, offset + 2_000);
        const values = chunk.map((row) => Prisma.sql`(
          ${randomUUID()}, ${row.employeeId}, ${row.attendanceDate}, ${row.checkIn ?? null}, ${row.checkOut ?? null},
          ${row.isLate}, ${row.lateMinutes}, ${new Prisma.Decimal(row.workingHours)},
          ${row.status}::"AttendanceStatus", ${row.approvalStatus ?? AttendanceApprovalStatus.NOT_APPROVED}::"AttendanceApprovalStatus",
          ${row.notes ?? null}, 1, NOW(), NOW(), NULL
        )`);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "Attendance" (
            "id", "employeeId", "attendanceDate", "checkIn", "checkOut", "isLate", "lateMinutes", "workingHours",
            "status", "approvalStatus", "notes", "version", "createdAt", "updatedAt", "deletedAt"
          ) VALUES ${Prisma.join(values)}
          ON CONFLICT ("employeeId", "attendanceDate") DO UPDATE SET
            "checkIn" = EXCLUDED."checkIn", "checkOut" = EXCLUDED."checkOut", "isLate" = EXCLUDED."isLate",
            "lateMinutes" = EXCLUDED."lateMinutes", "workingHours" = EXCLUDED."workingHours", "status" = EXCLUDED."status",
            "approvalStatus" = EXCLUDED."approvalStatus", "notes" = EXCLUDED."notes", "deletedAt" = NULL,
            "version" = "Attendance"."version" + 1, "updatedAt" = NOW()
        `);
      }
      await this.audit.record(tx, user, { action: AuditAction.IMPORT, entityType: 'Attendance', summary: 'Atomic attendance import completed', metadata: { rowCount: prepared.length, employeeCount: employeeIds.length } });
      return { imported: prepared.length, employeeCount: employeeIds.length };
    });
  }

  async list(query: QueryAttendanceDto, user: RequestUser) {
    const filters = await this.buildFilters(query, user);
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
      where: { AND: [{ id }, { deletedAt: null }, await this.accessWhere(user)] },
      include: attendanceInclude,
    });
    if (!record) throw new NotFoundException('Attendance record not found');
    return record;
  }

  async update(id: string, dto: UpdateAttendanceDto, user: RequestUser) {
    if (dto.employeeId) await this.ensureEmployee(dto.employeeId);
    return this.attendanceTransaction(async (tx) => {
      const record = await this.ensureExists(id, tx);
      const employeeId = dto.employeeId ?? record.employeeId;
      await this.authorization.assertEmployeeScope(user, record.employeeId, { all: 'attendance.hr.manage' });
      await this.authorization.assertEmployeeScope(user, employeeId, { all: 'attendance.hr.manage' });
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
          approvalStatus: dto.approvalStatus ?? record.approvalStatus,
          notes: dto.notes ?? record.notes ?? undefined,
        },
        attendanceDate,
      );
      const updated = await tx.attendance.update({
        where: { id },
        data: { ...data, version: { increment: 1 } },
        include: attendanceInclude,
      });
      const previousHours = new Prisma.Decimal(record.workingHours);
      const nextHours = new Prisma.Decimal(data.workingHours);
      if (record.status !== data.status || !previousHours.equals(nextHours)) {
        await tx.attendanceCorrection.create({
          data: {
            attendanceId: id,
            employeeId,
            correctedById: user.employeeId ?? null,
            previousStatus: record.status,
            nextStatus: data.status,
            previousHours,
            nextHours,
            reason: dto.correctionReason ?? dto.notes ?? 'HR attendance correction',
          },
        });
      }
      await this.audit.record(tx, user, {
        action: AuditAction.UPDATE,
        entityType: 'Attendance',
        entityId: id,
        summary: 'Attendance corrected',
        changes: [
          { field: 'status', previousValue: record.status, nextValue: data.status },
          { field: 'workingHours', previousValue: previousHours.toFixed(2), nextValue: nextHours.toFixed(2) },
          { field: 'approvalStatus', previousValue: record.approvalStatus, nextValue: data.approvalStatus },
        ],
      });
      return updated;
    });
  }

  async remove(id: string, user: RequestUser) {
    return this.attendanceTransaction(async (tx) => {
      const record = await this.ensureExists(id, tx);
      await this.authorization.assertEmployeeScope(user, record.employeeId, { all: 'attendance.hr.manage' });
      await this.assertPayrollIsOpen(record.employeeId, record.attendanceDate, tx);
      const removed = await tx.attendance.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'Attendance', entityId: id, summary: 'Attendance archived' });
      return removed;
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
      const checkedIn = await (existing
        ? tx.attendance.update({ where: { id: existing.id }, data, include: attendanceInclude })
        : tx.attendance.create({ data, include: attendanceInclude }));
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'Attendance', entityId: checkedIn.id, summary: 'Employee checked in' });
      return checkedIn;
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
      const checkedOut = await tx.attendance.update({
        where: { id: record.id },
        data: { checkOut: now, workingHours, version: { increment: 1 } },
        include: attendanceInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'Attendance', entityId: record.id, summary: 'Employee checked out' });
      return checkedOut;
    });
  }

  async report(query: QueryAttendanceDto, user: RequestUser) {
    if (!this.authorization.hasAny(user, ['attendance.team.read', 'attendance.management.read', 'attendance.hr.read', 'attendance.audit.read', 'attendance.read_all'])) {
      throw new ForbiddenException('Only managers and HR can access attendance reports');
    }

    const { page, limit, ...args } = listArgs(query, {
      allowedSortFields: ['createdAt', 'attendanceDate', 'checkIn', 'checkOut', 'workingHours', 'status'],
      defaultSortBy: 'attendanceDate',
      where: { AND: await this.buildFilters(query, user) },
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

  private async buildFilters(query: QueryAttendanceDto, user: RequestUser) {
    const filters: Prisma.AttendanceWhereInput[] = [await this.accessWhere(user)];
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

  private async accessWhere(user: RequestUser): Promise<Prisma.AttendanceWhereInput> {
    const scopes: Prisma.AttendanceWhereInput[] = [];
    for (const permission of ['attendance.hr.read', 'attendance.audit.read', 'attendance.read_all'] as const) {
      const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_EMPLOYEES);
      if (rule.unrestricted) {
        if (!rule.excludeIds.length) return {};
        scopes.push({ employeeId: { notIn: rule.excludeIds } });
      }
      else if (rule.includeIds.length) scopes.push({ employeeId: { in: rule.includeIds } });
    }
    if (user.employeeId && this.authorization.permissionAllowedForScope(user, 'attendance.self.read', AccessScopeType.SELF, user.employeeId)) scopes.push({ employeeId: user.employeeId });
    if (user.employeeId && this.authorization.has(user, 'attendance.team.read')) {
      const ids = (await this.prisma.employee.findMany({ where: { managerId: user.employeeId, deletedAt: null }, select: { id: true } }))
        .map(({ id }) => id).filter((id) => this.authorization.permissionAllowedForScope(user, 'attendance.team.read', AccessScopeType.DIRECT_REPORTS, id));
      if (ids.length) scopes.push({ employeeId: { in: ids } });
    }
    if (user.employeeId && this.authorization.has(user, 'attendance.management.read')) {
      const ids = (await this.authorization.managementTreeEmployeeIds(user.employeeId))
        .filter((id) => this.authorization.permissionAllowedForScope(user, 'attendance.management.read', AccessScopeType.MANAGEMENT_TREE, id));
      if (ids.length) scopes.push({ employeeId: { in: ids } });
    }
    return scopes.length ? { OR: scopes } : { employeeId: '__no_employee_scope__' };
  }

  private async resolveSelfOrHrEmployee(employeeId: string | undefined, user: RequestUser) {
    const targetEmployeeId = employeeId ?? user.employeeId;
    if (!targetEmployeeId) throw new NotFoundException('No employee profile is linked to this user');
    if (targetEmployeeId === user.employeeId) {
      if (!this.authorization.permissionAllowedForScope(user, 'attendance.self.create', AccessScopeType.SELF, targetEmployeeId)) throw new NotFoundException('Employee not found');
    } else await this.authorization.assertEmployeeScope(user, targetEmployeeId, { all: 'attendance.hr.manage' });
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
      approvalStatus: dto.approvalStatus,
    };
  }

  private async assertPayrollIsOpen(employeeId: string, attendanceDate: Date, tx: Prisma.TransactionClient) {
    const payroll = await tx.payroll.findFirst({
      where: {
        employeeId,
        year: attendanceDate.getUTCFullYear(),
        month: attendanceDate.getUTCMonth() + 1,
        payrollRun: { status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PUBLISHED, PayrollRunStatus.PAID] } },
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

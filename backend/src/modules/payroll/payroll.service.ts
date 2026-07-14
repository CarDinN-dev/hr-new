import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, EmploymentStatus, LeaveRequestStatus, PayrollStatus, Prisma, Role } from '@prisma/client';
import { hasHrAccess } from '../../common/constants/access.constants';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta, softDelete } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import { CreateSalaryRecordDto } from './dto/create-salary-record.dto';
import { GeneratePayrollDto } from './dto/generate-payroll.dto';
import { QueryPayrollDto } from './dto/query-payroll.dto';
import { QuerySalaryRecordsDto } from './dto/query-salary-records.dto';
import { UpdatePayrollDto } from './dto/update-payroll.dto';
import { UpdateSalaryRecordDto } from './dto/update-salary-record.dto';

const employeePayrollSelect = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  email: true,
  managerId: true,
  department: true,
  position: true,
};

const payrollInclude = {
  employee: { select: employeePayrollSelect },
  approvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
};

const salaryRecordInclude = {
  employee: { select: employeePayrollSelect },
};

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  async createSalaryRecord(dto: CreateSalaryRecordDto) {
    await this.ensureEmployee(dto.employeeId);
    this.assertDateRange(dto.effectiveFrom, dto.effectiveTo, 'effectiveTo');
    return this.payrollTransaction(async (tx) => {
      await this.assertSalaryPeriodAvailable(dto.employeeId, dto.effectiveFrom, dto.effectiveTo, undefined, tx);
      return tx.salaryRecord.create({ data: dto, include: salaryRecordInclude });
    });
  }

  async listSalaryRecords(query: QuerySalaryRecordsDto, user: RequestUser) {
    const filters: Record<string, unknown>[] = [this.payrollAccessWhere(user)];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });

    const { page, limit, ...args } = listArgs(query, {
      allowedSortFields: ['createdAt', 'effectiveFrom', 'baseSalary'],
      defaultSortBy: 'effectiveFrom',
      where: { AND: filters },
      include: salaryRecordInclude,
    });

    const [data, total] = await Promise.all([
      this.prisma.salaryRecord.findMany(args),
      this.prisma.salaryRecord.count({ where: args.where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findSalaryRecordById(id: string, user: RequestUser) {
    const record = await this.prisma.salaryRecord.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, this.payrollAccessWhere(user)] },
      include: salaryRecordInclude,
    });
    if (!record) throw new NotFoundException('Salary record not found');
    return record;
  }

  async updateSalaryRecord(id: string, dto: UpdateSalaryRecordDto) {
    return this.payrollTransaction(async (tx) => {
      const record = await tx.salaryRecord.findFirst({ where: { id, deletedAt: null } });
      if (!record) throw new NotFoundException('Salary record not found');
      const effectiveFrom = dto.effectiveFrom ?? record.effectiveFrom;
      const effectiveTo = dto.effectiveTo ?? record.effectiveTo ?? undefined;
      this.assertDateRange(effectiveFrom, effectiveTo, 'effectiveTo');
      await this.assertSalaryPeriodAvailable(record.employeeId, effectiveFrom, effectiveTo, id, tx);
      return tx.salaryRecord.update({ where: { id }, data: dto, include: salaryRecordInclude });
    });
  }

  async removeSalaryRecord(id: string) {
    await this.ensureSalaryRecord(id);
    return softDelete(this.prisma.salaryRecord, id, 'Salary record');
  }

  async create(dto: CreatePayrollDto) {
    await this.ensureEmployee(dto.employeeId);
    const totals = this.payrollTotals(dto);
    return this.prisma.payroll.create({
      data: { ...dto, ...totals, status: PayrollStatus.DRAFT },
      include: payrollInclude,
    });
  }

  async list(query: QueryPayrollDto, user: RequestUser) {
    const filters: Record<string, unknown>[] = [this.payrollAccessWhere(user)];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.year) filters.push({ year: query.year });
    if (query.month) filters.push({ month: query.month });
    if (query.status) filters.push({ status: query.status });

    const { page, limit, ...args } = listArgs(query, {
      allowedSortFields: ['createdAt', 'year', 'month', 'grossPay', 'netPay', 'status'],
      defaultSortBy: 'createdAt',
      where: { AND: filters },
      include: payrollInclude,
    });

    const [data, total] = await Promise.all([
      this.prisma.payroll.findMany(args),
      this.prisma.payroll.count({ where: args.where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findById(id: string, user: RequestUser) {
    const payroll = await this.prisma.payroll.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, this.payrollAccessWhere(user)] },
      include: payrollInclude,
    });
    if (!payroll) throw new NotFoundException('Payroll record not found');
    return payroll;
  }

  async update(id: string, dto: UpdatePayrollDto) {
    return this.payrollTransaction(async (tx) => {
      const payroll = await this.ensurePayroll(id, tx);
      if (payroll.status === PayrollStatus.APPROVED || payroll.status === PayrollStatus.PAID) {
        throw new BadRequestException('Approved or paid payroll cannot be edited');
      }
      const totals = this.payrollTotals({
        baseSalary: dto.baseSalary ?? Number(payroll.baseSalary),
        allowances: dto.allowances ?? Number(payroll.allowances),
        deductions: dto.deductions ?? Number(payroll.deductions),
        bonuses: dto.bonuses ?? Number(payroll.bonuses),
        taxAmount: dto.taxAmount ?? Number(payroll.taxAmount),
      });
      return tx.payroll.update({ where: { id }, data: { ...dto, ...totals }, include: payrollInclude });
    });
  }

  async remove(id: string) {
    return this.payrollTransaction(async (tx) => {
      const payroll = await this.ensurePayroll(id, tx);
      if (payroll.status === PayrollStatus.APPROVED || payroll.status === PayrollStatus.PAID) {
        throw new BadRequestException('Approved or paid payroll cannot be deleted');
      }
      return tx.payroll.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  async generate(dto: GeneratePayrollDto) {
    const employees = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        employmentStatus: { in: [EmploymentStatus.ACTIVE, EmploymentStatus.ON_LEAVE, EmploymentStatus.PROBATION] },
        id: dto.employeeId,
      },
    });

    const monthStart = new Date(Date.UTC(dto.year, dto.month - 1, 1));
    const monthEnd = new Date(Date.UTC(dto.year, dto.month, 0, 23, 59, 59, 999));

    const generated = [];
    let skippedFinalizedCount = 0;
    for (const employee of employees) {
      const result = await this.payrollTransaction(async (tx) => {
        const existing = await tx.payroll.findUnique({
          where: {
            employeeId_year_month: {
              employeeId: employee.id,
              year: dto.year,
              month: dto.month,
            },
          },
          include: payrollInclude,
        });
        if (
          existing
          && !existing.deletedAt
          && (existing.status === PayrollStatus.APPROVED || existing.status === PayrollStatus.PAID)
        ) {
          return { record: existing, skipped: true };
        }

        const salaryRecord = await tx.salaryRecord.findFirst({
          where: {
            employeeId: employee.id,
            deletedAt: null,
            effectiveFrom: { lte: monthEnd },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: monthStart } }],
          },
          orderBy: { effectiveFrom: 'desc' },
        });

        const baseSalary = Number(salaryRecord?.baseSalary ?? employee.salary);
        const allowances = Number(salaryRecord?.allowances ?? 0);
        const fixedDeductions = Number(salaryRecord?.deductions ?? 0);
        const bonuses = Number(salaryRecord?.bonuses ?? 0);
        const taxRate = Number(salaryRecord?.taxRate ?? 0);
        const grossPay = baseSalary + allowances + bonuses;
        const taxAmount = Number(((grossPay * taxRate) / 100).toFixed(2));
        const lopDays = await this.payrollLopDays(employee.id, monthStart, monthEnd, tx);
        const lopAmount = Number(((baseSalary / 30) * lopDays).toFixed(2));
        const deductions = fixedDeductions + lopAmount;
        const netPay = Math.max(0, Number((grossPay - deductions - taxAmount).toFixed(2)));

        const record = await tx.payroll.upsert({
          where: {
            employeeId_year_month: {
              employeeId: employee.id,
              year: dto.year,
              month: dto.month,
            },
          },
          update: {
            baseSalary,
            allowances,
            deductions,
            bonuses,
            taxAmount,
            grossPay,
            netPay,
            status: PayrollStatus.GENERATED,
            generatedAt: new Date(),
            approvedById: null,
            approvedAt: null,
            paidAt: null,
            deletedAt: null,
          },
          create: {
            employeeId: employee.id,
            year: dto.year,
            month: dto.month,
            baseSalary,
            allowances,
            deductions,
            bonuses,
            taxAmount,
            grossPay,
            netPay,
            status: PayrollStatus.GENERATED,
          },
          include: payrollInclude,
        });
        return { record, skipped: false };
      });
      generated.push(result.record);
      if (result.skipped) skippedFinalizedCount += 1;
    }

    return {
      data: generated,
      meta: {
        generatedCount: generated.length - skippedFinalizedCount,
        skippedFinalizedCount,
        year: dto.year,
        month: dto.month,
      },
    };
  }

  async approve(id: string, user: RequestUser) {
    return this.payrollTransaction(async (tx) => {
      const payroll = await this.ensurePayroll(id, tx);
      if (payroll.status !== PayrollStatus.GENERATED) {
        throw new BadRequestException('Only generated payroll can be approved');
      }
      return tx.payroll.update({
        where: { id },
        data: {
          status: PayrollStatus.APPROVED,
          approvedById: user.employeeId ?? null,
          approvedAt: new Date(),
        },
        include: payrollInclude,
      });
    });
  }

  async markPaid(id: string) {
    return this.payrollTransaction(async (tx) => {
      const payroll = await this.ensurePayroll(id, tx);
      if (payroll.status !== PayrollStatus.APPROVED) {
        throw new BadRequestException('Only approved payroll can be marked paid');
      }
      return tx.payroll.update({
        where: { id },
        data: { status: PayrollStatus.PAID, paidAt: new Date() },
        include: payrollInclude,
      });
    });
  }

  async payslip(employeeId: string, year: number, month: number, user: RequestUser) {
    if (!hasHrAccess(user.role) && user.employeeId !== employeeId) {
      throw new NotFoundException('Payslip not found');
    }

    const payroll = await this.prisma.payroll.findFirst({
      where: { employeeId, year, month, deletedAt: null },
      include: payrollInclude,
    });
    if (!payroll) throw new NotFoundException('Payslip not found');
    return payroll;
  }

  private payrollAccessWhere(user: RequestUser) {
    if (hasHrAccess(user.role)) return {};
    if (!user.employeeId) return { employeeId: '__no_employee_profile__' };
    if (user.role === Role.MANAGER) return { employeeId: user.employeeId };
    return { employeeId: user.employeeId };
  }

  private async payrollLopDays(
    employeeId: string,
    monthStart: Date,
    monthEnd: Date,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const days = new Map<string, number>();
    const attendance = await client.attendance.findMany({
      where: {
        employeeId,
        deletedAt: null,
        attendanceDate: { gte: monthStart, lte: monthEnd },
        status: { in: [AttendanceStatus.ABSENT, AttendanceStatus.HALF_DAY] },
      },
      select: { attendanceDate: true, status: true },
    });

    for (const record of attendance) {
      days.set(this.dateKey(record.attendanceDate), record.status === AttendanceStatus.ABSENT ? 1 : 0.5);
    }

    const unpaidLeaves = await client.leaveRequest.findMany({
      where: {
        employeeId,
        deletedAt: null,
        status: LeaveRequestStatus.APPROVED,
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
        leaveType: { isPaid: false },
      },
      select: { startDate: true, endDate: true, totalDays: true },
    });

    for (const leave of unpaidLeaves) {
      const leaveStart = leave.startDate > monthStart ? leave.startDate : monthStart;
      const leaveEnd = leave.endDate < monthEnd ? leave.endDate : monthEnd;
      const spanDays = this.inclusiveDays(leave.startDate, leave.endDate);
      const perDay = Math.min(1, Number(leave.totalDays) / spanDays);
      for (const date of this.eachDay(leaveStart, leaveEnd)) {
        const key = this.dateKey(date);
        days.set(key, Math.max(days.get(key) ?? 0, perDay));
      }
    }

    return Array.from(days.values()).reduce((sum, value) => sum + value, 0);
  }

  private *eachDay(start: Date, end: Date) {
    for (const day = this.dayStart(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
      yield new Date(day);
    }
  }

  private inclusiveDays(start: Date, end: Date) {
    return Math.max(1, Math.round((Number(this.dayStart(end)) - Number(this.dayStart(start))) / 86_400_000) + 1);
  }

  private dateKey(date: Date) {
    return this.dayStart(date).toISOString().slice(0, 10);
  }

  private dayStart(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private async ensureEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!employee) throw new NotFoundException('Employee not found');
  }

  private async ensurePayroll(id: string, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const payroll = await client.payroll.findFirst({ where: { id, deletedAt: null } });
    if (!payroll) throw new NotFoundException('Payroll record not found');
    return payroll;
  }

  private async ensureSalaryRecord(id: string) {
    const record = await this.prisma.salaryRecord.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Salary record not found');
  }

  private assertDateRange(start: Date, end: Date | undefined, endField: string) {
    if (end && end < start) throw new BadRequestException(`${endField} must be on or after the start date`);
  }

  private async assertSalaryPeriodAvailable(
    employeeId: string,
    effectiveFrom: Date,
    effectiveTo: Date | undefined,
    excludeId: string | undefined,
    tx: Prisma.TransactionClient,
  ) {
    const overlap = await tx.salaryRecord.findFirst({
      where: {
        employeeId,
        id: excludeId ? { not: excludeId } : undefined,
        deletedAt: null,
        effectiveFrom: effectiveTo ? { lte: effectiveTo } : undefined,
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
      select: { id: true },
    });
    if (overlap) throw new ConflictException('Salary record dates overlap an existing record');
  }

  private payrollTotals(values: {
    baseSalary: number;
    allowances?: number;
    deductions?: number;
    bonuses?: number;
    taxAmount?: number;
  }) {
    const grossPay = Number((values.baseSalary + (values.allowances ?? 0) + (values.bonuses ?? 0)).toFixed(2));
    const netPay = Math.max(0, Number((grossPay - (values.deductions ?? 0) - (values.taxAmount ?? 0)).toFixed(2)));
    return { grossPay, netPay };
  }

  private async payrollTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      }
    }
    throw new ConflictException('Payroll changed in another request. Try again.');
  }
}

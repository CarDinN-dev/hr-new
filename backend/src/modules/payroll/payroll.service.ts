import { Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, EmploymentStatus, LeaveRequestStatus, PayrollStatus, Role } from '@prisma/client';
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
    return this.prisma.salaryRecord.create({ data: dto, include: salaryRecordInclude });
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
    await this.ensureSalaryRecord(id);
    if (dto.employeeId) await this.ensureEmployee(dto.employeeId);
    return this.prisma.salaryRecord.update({ where: { id }, data: dto, include: salaryRecordInclude });
  }

  async removeSalaryRecord(id: string) {
    await this.ensureSalaryRecord(id);
    return softDelete(this.prisma.salaryRecord, id, 'Salary record');
  }

  async create(dto: CreatePayrollDto) {
    await this.ensureEmployee(dto.employeeId);
    return this.prisma.payroll.create({ data: dto, include: payrollInclude });
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
    await this.ensurePayroll(id);
    if (dto.employeeId) await this.ensureEmployee(dto.employeeId);
    return this.prisma.payroll.update({ where: { id }, data: dto, include: payrollInclude });
  }

  async remove(id: string) {
    await this.ensurePayroll(id);
    return softDelete(this.prisma.payroll, id, 'Payroll record');
  }

  async generate(dto: GeneratePayrollDto) {
    const employees = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        employmentStatus: { in: [EmploymentStatus.ACTIVE, EmploymentStatus.ON_LEAVE, EmploymentStatus.PROBATION] },
        id: dto.employeeId,
      },
    });

    const monthStart = new Date(dto.year, dto.month - 1, 1);
    const monthEnd = new Date(dto.year, dto.month, 0, 23, 59, 59, 999);

    const generated = [];
    for (const employee of employees) {
      const salaryRecord = await this.prisma.salaryRecord.findFirst({
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
      const lopDays = await this.payrollLopDays(employee.id, monthStart, monthEnd);
      const lopAmount = Number(((baseSalary / 30) * lopDays).toFixed(2));
      const deductions = fixedDeductions + lopAmount;
      const netPay = Number((grossPay - deductions - taxAmount).toFixed(2));

      generated.push(
        await this.prisma.payroll.upsert({
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
        }),
      );
    }

    return { data: generated, meta: { generatedCount: generated.length, year: dto.year, month: dto.month } };
  }

  async approve(id: string, user: RequestUser) {
    await this.ensurePayroll(id);
    return this.prisma.payroll.update({
      where: { id },
      data: {
        status: PayrollStatus.APPROVED,
        approvedById: user.employeeId ?? null,
        approvedAt: new Date(),
      },
      include: payrollInclude,
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

  private async payrollLopDays(employeeId: string, monthStart: Date, monthEnd: Date) {
    const days = new Map<string, number>();
    const attendance = await this.prisma.attendance.findMany({
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

    const unpaidLeaves = await this.prisma.leaveRequest.findMany({
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
    for (const day = this.dayStart(start); day <= end; day.setDate(day.getDate() + 1)) {
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
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    return value;
  }

  private async ensureEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!employee) throw new NotFoundException('Employee not found');
  }

  private async ensurePayroll(id: string) {
    const payroll = await this.prisma.payroll.findFirst({ where: { id, deletedAt: null } });
    if (!payroll) throw new NotFoundException('Payroll record not found');
  }

  private async ensureSalaryRecord(id: string) {
    const record = await this.prisma.salaryRecord.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Salary record not found');
  }
}

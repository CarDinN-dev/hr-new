import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, AuditAction, EmploymentStatus, LeaveRequestStatus, PayrollLineKind, PayrollStatus, Prisma } from '@prisma/client';
import { hasAnyPermission } from '../../common/authorization';
import { money, MoneyInput, nonNegativeMoney, percentageMoney, sumMoney, ZERO_MONEY } from '../../common/money';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import { CreateSalaryRecordDto } from './dto/create-salary-record.dto';
import { GeneratePayrollDto } from './dto/generate-payroll.dto';
import { QueryPayrollDto } from './dto/query-payroll.dto';
import { QuerySalaryRecordsDto } from './dto/query-salary-records.dto';
import { UpdatePayrollDto } from './dto/update-payroll.dto';
import { UpdateSalaryRecordDto } from './dto/update-salary-record.dto';
import { AuditService } from '../audit/audit.service';
import { LoansService } from '../loans/loans.service';

const employeePayrollSelect = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  email: true,
  hireDate: true,
  employmentStatus: true,
  managerId: true,
  department: true,
  position: true,
};

const payrollInclude = {
  employee: { select: employeePayrollSelect },
  approvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  lineItems: { orderBy: { createdAt: 'asc' as const } },
  loanRepayments: { orderBy: { postedAt: 'asc' as const } },
};

const salaryRecordInclude = {
  employee: { select: employeePayrollSelect },
};

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loans: LoansService,
    private readonly audit: AuditService,
  ) {}

  async createSalaryRecord(dto: CreateSalaryRecordDto, user: RequestUser) {
    await this.ensureEmployee(dto.employeeId);
    this.assertDateRange(dto.effectiveFrom, dto.effectiveTo, 'effectiveTo');
    return this.payrollTransaction(async (tx) => {
      await this.assertSalaryPeriodAvailable(dto.employeeId, dto.effectiveFrom, dto.effectiveTo, undefined, tx);
      const record = await tx.salaryRecord.create({
        data: {
          ...dto,
          baseSalary: nonNegativeMoney(dto.baseSalary, 'baseSalary', '1000000000'),
          allowances: nonNegativeMoney(dto.allowances ?? 0, 'allowances', '1000000000'),
          deductions: nonNegativeMoney(dto.deductions ?? 0, 'deductions', '1000000000'),
          bonuses: nonNegativeMoney(dto.bonuses ?? 0, 'bonuses', '1000000000'),
          taxRate: nonNegativeMoney(dto.taxRate ?? 0, 'taxRate', '100'),
        },
        include: salaryRecordInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'SalaryRecord', entityId: record.id, summary: 'Salary record created' });
      return record;
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
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, entityType: 'SalaryRecord', summary: 'Compensation records viewed' });
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findSalaryRecordById(id: string, user: RequestUser) {
    const record = await this.prisma.salaryRecord.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, this.payrollAccessWhere(user)] },
      include: salaryRecordInclude,
    });
    if (!record) throw new NotFoundException('Salary record not found');
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, entityType: 'SalaryRecord', entityId: id, summary: 'Compensation record viewed' });
    return record;
  }

  async updateSalaryRecord(id: string, dto: UpdateSalaryRecordDto, user: RequestUser) {
    return this.payrollTransaction(async (tx) => {
      const record = await tx.salaryRecord.findFirst({ where: { id, deletedAt: null } });
      if (!record) throw new NotFoundException('Salary record not found');
      const effectiveFrom = dto.effectiveFrom ?? record.effectiveFrom;
      const effectiveTo = dto.effectiveTo ?? record.effectiveTo ?? undefined;
      this.assertDateRange(effectiveFrom, effectiveTo, 'effectiveTo');
      await this.assertSalaryPeriodAvailable(record.employeeId, effectiveFrom, effectiveTo, id, tx);
      const updated = await tx.salaryRecord.update({
        where: { id },
        data: {
          ...dto,
          baseSalary: dto.baseSalary === undefined ? undefined : nonNegativeMoney(dto.baseSalary, 'baseSalary', '1000000000'),
          allowances: dto.allowances === undefined ? undefined : nonNegativeMoney(dto.allowances, 'allowances', '1000000000'),
          deductions: dto.deductions === undefined ? undefined : nonNegativeMoney(dto.deductions, 'deductions', '1000000000'),
          bonuses: dto.bonuses === undefined ? undefined : nonNegativeMoney(dto.bonuses, 'bonuses', '1000000000'),
          taxRate: dto.taxRate === undefined ? undefined : nonNegativeMoney(dto.taxRate, 'taxRate', '100'),
          version: { increment: 1 },
        },
        include: salaryRecordInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'SalaryRecord', entityId: id, summary: 'Salary record updated' });
      return updated;
    });
  }

  async removeSalaryRecord(id: string, user: RequestUser) {
    return this.payrollTransaction(async (tx) => {
      await this.ensureSalaryRecord(id, tx);
      const removed = await tx.salaryRecord.update({ where: { id }, data: { deletedAt: new Date() }, include: salaryRecordInclude });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'SalaryRecord', entityId: id, summary: 'Salary record archived' });
      return removed;
    });
  }

  async create(dto: CreatePayrollDto, user: RequestUser) {
    await this.ensureEmployee(dto.employeeId);
    const amounts = this.payrollAmounts(dto);
    const totals = this.payrollTotals(amounts);
    return this.payrollTransaction(async (tx) => {
      const payroll = await tx.payroll.create({
        data: { employeeId: dto.employeeId, year: dto.year, month: dto.month, ...amounts, ...totals, status: PayrollStatus.DRAFT },
        include: payrollInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'Payroll', entityId: payroll.id, summary: 'Payroll draft created' });
      return payroll;
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
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, entityType: 'Payroll', summary: 'Payroll records viewed' });
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findById(id: string, user: RequestUser) {
    const payroll = await this.prisma.payroll.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, this.payrollAccessWhere(user)] },
      include: payrollInclude,
    });
    if (!payroll) throw new NotFoundException('Payroll record not found');
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, entityType: 'Payroll', entityId: id, summary: 'Payroll record viewed' });
    return payroll;
  }

  async update(id: string, dto: UpdatePayrollDto, user: RequestUser) {
    return this.payrollTransaction(async (tx) => {
      const payroll = await this.ensurePayroll(id, tx);
      if (payroll.status === PayrollStatus.APPROVED || payroll.status === PayrollStatus.PAID) {
        throw new BadRequestException('Approved or paid payroll cannot be edited');
      }
      const totals = this.payrollTotals({
        baseSalary: dto.baseSalary ?? payroll.baseSalary,
        allowances: dto.allowances ?? payroll.allowances,
        deductions: dto.deductions ?? payroll.deductions,
        bonuses: dto.bonuses ?? payroll.bonuses,
        taxAmount: dto.taxAmount ?? payroll.taxAmount,
      });
      const amounts = this.payrollAmounts({
        baseSalary: dto.baseSalary ?? payroll.baseSalary,
        allowances: dto.allowances ?? payroll.allowances,
        deductions: dto.deductions ?? payroll.deductions,
        bonuses: dto.bonuses ?? payroll.bonuses,
        taxAmount: dto.taxAmount ?? payroll.taxAmount,
      });
      const updated = await tx.payroll.update({ where: { id }, data: { ...amounts, ...totals, version: { increment: 1 } }, include: payrollInclude });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'Payroll', entityId: id, summary: 'Payroll draft updated' });
      return updated;
    });
  }

  async remove(id: string, user: RequestUser) {
    return this.payrollTransaction(async (tx) => {
      const payroll = await this.ensurePayroll(id, tx);
      if (payroll.status === PayrollStatus.APPROVED || payroll.status === PayrollStatus.PAID) {
        throw new BadRequestException('Approved or paid payroll cannot be deleted');
      }
      const removed = await tx.payroll.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'Payroll', entityId: id, summary: 'Payroll draft archived' });
      return removed;
    });
  }

  async generate(dto: GeneratePayrollDto, user: RequestUser) {
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

        if (existing) await this.loans.postPayrollDeductions(existing.id, dto.year, dto.month, [], tx);

        const salaryRecord = await tx.salaryRecord.findFirst({
          where: {
            employeeId: employee.id,
            deletedAt: null,
            effectiveFrom: { lte: monthEnd },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: monthStart } }],
          },
          orderBy: { effectiveFrom: 'desc' },
        });

        const baseSalary = nonNegativeMoney(salaryRecord?.baseSalary ?? employee.salary, 'baseSalary');
        const allowances = nonNegativeMoney(salaryRecord?.allowances ?? 0, 'allowances');
        const fixedDeductions = nonNegativeMoney(salaryRecord?.deductions ?? 0, 'deductions');
        const bonuses = nonNegativeMoney(salaryRecord?.bonuses ?? 0, 'bonuses');
        const taxRate = nonNegativeMoney(salaryRecord?.taxRate ?? 0, 'taxRate');
        const grossPay = sumMoney([baseSalary, allowances, bonuses]);
        const taxAmount = percentageMoney(grossPay, taxRate);
        const lopDays = await this.payrollLopDays(employee.id, monthStart, monthEnd, tx);
        const lopAmount = money(baseSalary.div(30).times(lopDays), 'loss of pay');
        const loanPlan = await this.loans.preparePayrollDeductions(employee.id, dto.year, dto.month, tx);
        const deductions = sumMoney([fixedDeductions, lopAmount, loanPlan.total]);
        const netPay = Prisma.Decimal.max(ZERO_MONEY, grossPay.minus(deductions).minus(taxAmount));

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
            version: { increment: 1 },
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
        await tx.payrollLineItem.deleteMany({ where: { payrollId: record.id } });
        const standardLines = [
          { kind: PayrollLineKind.BASE_SALARY, description: 'Base salary', amount: baseSalary },
          { kind: PayrollLineKind.ALLOWANCE, description: 'Allowances', amount: allowances },
          { kind: PayrollLineKind.BONUS, description: 'Bonuses', amount: bonuses },
          { kind: PayrollLineKind.FIXED_DEDUCTION, description: 'Fixed deductions', amount: fixedDeductions },
          { kind: PayrollLineKind.LOSS_OF_PAY, description: `Loss of pay (${lopDays.toFixed(2)} days)`, amount: lopAmount },
          { kind: PayrollLineKind.TAX, description: 'Tax deduction', amount: taxAmount },
        ].filter((line) => !line.amount.isZero());
        if (standardLines.length) {
          await tx.payrollLineItem.createMany({ data: standardLines.map((line) => ({ payrollId: record.id, ...line })) });
        }
        await this.loans.postPayrollDeductions(record.id, dto.year, dto.month, loanPlan.deductions, tx);
        await this.audit.record(tx, user, {
          action: AuditAction.TRANSITION,
          entityType: 'Payroll',
          entityId: record.id,
          summary: 'Payroll generated from normalized attendance, leave, salary, and loan records',
        });
        const hydrated = await tx.payroll.findUniqueOrThrow({ where: { id: record.id }, include: payrollInclude });
        return { record: hydrated, skipped: false };
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
      const updated = await tx.payroll.update({
        where: { id },
        data: {
          status: PayrollStatus.APPROVED,
          approvedById: user.employeeId ?? null,
          approvedAt: new Date(),
          version: { increment: 1 },
        },
        include: payrollInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, entityType: 'Payroll', entityId: id, summary: 'Payroll approved' });
      return updated;
    });
  }

  async markPaid(id: string, user: RequestUser) {
    return this.payrollTransaction(async (tx) => {
      const payroll = await this.ensurePayroll(id, tx);
      if (payroll.status !== PayrollStatus.APPROVED) {
        throw new BadRequestException('Only approved payroll can be marked paid');
      }
      const updated = await tx.payroll.update({
        where: { id },
        data: { status: PayrollStatus.PAID, paidAt: new Date(), version: { increment: 1 } },
        include: payrollInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, entityType: 'Payroll', entityId: id, summary: 'Payroll marked paid' });
      return updated;
    });
  }

  async payslip(employeeId: string, year: number, month: number, user: RequestUser) {
    if (!hasAnyPermission(user, ['payroll.read', 'payroll.audit.read']) && user.employeeId !== employeeId) {
      throw new NotFoundException('Payslip not found');
    }

    const payroll = await this.prisma.payroll.findFirst({
      where: { employeeId, year, month, deletedAt: null },
      include: payrollInclude,
    });
    if (!payroll) throw new NotFoundException('Payslip not found');
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, entityType: 'Payroll', entityId: payroll.id, summary: 'Payslip viewed' });
    return payroll;
  }

  private payrollAccessWhere(user: RequestUser) {
    if (hasAnyPermission(user, ['payroll.read', 'payroll.read_compensation', 'payroll.audit.read'])) return {};
    return user.employeeId && hasAnyPermission(user, ['payroll.self.read_payslip'])
      ? { employeeId: user.employeeId }
      : { employeeId: '__salary_access_denied__' };
  }

  private async payrollLopDays(
    employeeId: string,
    monthStart: Date,
    monthEnd: Date,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const days = new Map<string, Prisma.Decimal>();
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
      days.set(this.dateKey(record.attendanceDate), new Prisma.Decimal(record.status === AttendanceStatus.ABSENT ? 1 : 0.5));
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
      const perDay = Prisma.Decimal.min(1, leave.totalDays.div(spanDays));
      for (const date of this.eachDay(leaveStart, leaveEnd)) {
        const key = this.dateKey(date);
        days.set(key, Prisma.Decimal.max(days.get(key) ?? ZERO_MONEY, perDay));
      }
    }

    return sumMoney(Array.from(days.values()));
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

  private async ensureSalaryRecord(id: string, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const record = await client.salaryRecord.findFirst({ where: { id, deletedAt: null } });
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

  private payrollAmounts(values: {
    baseSalary: MoneyInput;
    allowances?: MoneyInput;
    deductions?: MoneyInput;
    bonuses?: MoneyInput;
    taxAmount?: MoneyInput;
  }) {
    return {
      baseSalary: nonNegativeMoney(values.baseSalary, 'baseSalary'),
      allowances: nonNegativeMoney(values.allowances ?? 0, 'allowances'),
      deductions: nonNegativeMoney(values.deductions ?? 0, 'deductions'),
      bonuses: nonNegativeMoney(values.bonuses ?? 0, 'bonuses'),
      taxAmount: nonNegativeMoney(values.taxAmount ?? 0, 'taxAmount'),
    };
  }

  private payrollTotals(values: {
    baseSalary: MoneyInput;
    allowances?: MoneyInput;
    deductions?: MoneyInput;
    bonuses?: MoneyInput;
    taxAmount?: MoneyInput;
  }) {
    const amounts = this.payrollAmounts(values);
    const grossPay = sumMoney([amounts.baseSalary, amounts.allowances, amounts.bonuses]);
    const netPay = Prisma.Decimal.max(ZERO_MONEY, grossPay.minus(amounts.deductions).minus(amounts.taxAmount));
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

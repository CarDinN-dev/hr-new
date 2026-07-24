import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccessScopeType, AttendanceStatus, AuditAction, EmploymentStatus, LeaveRequestStatus, LoanRepaymentStatus,
  PayrollAdjustmentDirection, PayrollLineKind, PayrollPaymentStatus, PayrollRunStatus, PayrollRunType, Prisma,
} from '@prisma/client';
import { createHash } from 'crypto';
import { jsPDF } from 'jspdf';
import { money, nonNegativeMoney, percentageMoney, sumMoney, ZERO_MONEY } from '../../common/money';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { stripControlCharacters } from '../../common/utils/text.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { DocumentStorageService } from '../documents/document-storage.service';
import { LoansService } from '../loans/loans.service';
import { CreateSalaryRecordDto } from './dto/create-salary-record.dto';
import { GeneratePayrollDto } from './dto/generate-payroll.dto';
import { CreatePayrollAdjustmentDto, QueryPayrollAdjustmentsDto, ReconcilePayrollPaymentItemDto } from './dto/payroll-adjustment.dto';
import { MarkPayrollPaidDto, ReconcilePayrollPaymentsDto } from './dto/payment-reconciliation.dto';
import { PayrollReasonTransitionDto, PayrollTransitionDto } from './dto/payroll-workflow.dto';
import { QueryPayrollDto } from './dto/query-payroll.dto';
import { QuerySalaryRecordsDto } from './dto/query-salary-records.dto';
import { UpdateSalaryRecordDto } from './dto/update-salary-record.dto';

const employeePayrollSelect = {
  id: true, userId: true, employeeCode: true, firstName: true, lastName: true, email: true, hireDate: true,
  employmentStatus: true, departmentId: true, department: { select: { id: true, name: true, code: true } },
  position: { select: { id: true, title: true, code: true } },
} satisfies Prisma.EmployeeSelect;

const payrollInclude = {
  employee: { select: employeePayrollSelect },
  payrollRun: { select: { id: true, status: true, revision: true, generatedAt: true, approvedAt: true, publishedAt: true, paidAt: true, version: true } },
  lineItems: { orderBy: { createdAt: 'asc' as const } },
  loanRepayments: { orderBy: { postedAt: 'asc' as const } },
} satisfies Prisma.PayrollInclude;

const payrollRunInclude = {
  generatedBy: { select: { id: true, email: true } }, approvedBy: { select: { id: true, email: true } },
  publishedBy: { select: { id: true, email: true } }, paidBy: { select: { id: true, email: true } },
  cancelledBy: { select: { id: true, email: true } },
  payrolls: { include: { employee: { select: employeePayrollSelect }, lineItems: { orderBy: { createdAt: 'asc' as const } }, loanRepayments: true } },
} satisfies Prisma.PayrollRunInclude;

const salaryRecordInclude = { employee: { select: employeePayrollSelect } } satisfies Prisma.SalaryRecordInclude;
type PayrollView = Prisma.PayrollGetPayload<{ include: typeof payrollInclude }>;
type PayrollRunView = Prisma.PayrollRunGetPayload<{ include: typeof payrollRunInclude }>;
type PayrollIssue = { severity: 'ERROR' | 'WARNING'; code: string; message: string; employeeId?: string; employeeCode?: string };
type CalculationSalaryRecord = {
  id: string; version: number; effectiveFrom: Date; effectiveTo: Date | null;
  baseSalary: Prisma.Decimal; hra: Prisma.Decimal; conveyance: Prisma.Decimal; mobile: Prisma.Decimal; food: Prisma.Decimal; fuel: Prisma.Decimal; other: Prisma.Decimal; grossAdjustment: Prisma.Decimal;
  allowances: Prisma.Decimal; deductions: Prisma.Decimal; bonuses: Prisma.Decimal; taxRate: Prisma.Decimal;
};
type CalculationEmployee = {
  id: string; employeeCode: string; firstName: string; lastName: string; hireDate: Date; salary: Prisma.Decimal;
  bankAccount: { bankCode: string | null; iban: string | null; accountNumber: string | null } | null;
  profile: { wpsSponsor: string | null } | null;
  credentials: Array<{ type: string; number: string | null }>;
  salaryRecords: CalculationSalaryRecord[];
};
type SalarySource = {
  id: string; version: number; record: CalculationSalaryRecord | null; baseSalary: Prisma.Decimal; allowances: Prisma.Decimal; bonuses: Prisma.Decimal; deductions: Prisma.Decimal; taxRate: Prisma.Decimal;
  allowanceLines: Array<{ description: string; amount: Prisma.Decimal }>;
};
type PayrollCalculation = {
  employee: CalculationEmployee; baseSalary: Prisma.Decimal; allowances: Prisma.Decimal; bonuses: Prisma.Decimal; fixedDeductions: Prisma.Decimal; taxAmount: Prisma.Decimal;
  grossPay: Prisma.Decimal; deductions: Prisma.Decimal; rawNetPay: Prisma.Decimal; netPay: Prisma.Decimal; lopDays: Prisma.Decimal; lopAmount: Prisma.Decimal;
  loanPlan: Awaited<ReturnType<LoansService['preparePayrollDeductions']>>;
  adjustments: Array<{ id: string; direction: PayrollAdjustmentDirection; amount: Prisma.Decimal; taxable: boolean; description: string; reason: string }>;
  lines: Array<{ kind: PayrollLineKind; description: string; amount: Prisma.Decimal }>;
  snapshot: Prisma.InputJsonValue; calculationHash: string; issues: PayrollIssue[];
};
type PayrollPreflight = {
  year: number; month: number; runType: PayrollRunType; purpose?: string; calculations: PayrollCalculation[]; issues: PayrollIssue[];
  policy: { prorationBasis: 'FIXED_30' | 'CALENDAR_DAYS'; requireBankDetails: boolean; requireAttendance: boolean; varianceThreshold: Prisma.Decimal; financialPolicyVersion: number };
};

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loans: LoansService,
    private readonly audit: AuditService,
    private readonly storage: DocumentStorageService,
    private readonly authorization: AuthorizationService,
  ) {}

  async createSalaryRecord(dto: CreateSalaryRecordDto, user: RequestUser) {
    await this.authorization.assertEmployeeScope(user, dto.employeeId, { all: 'payroll.configure' });
    await this.ensureEmployee(dto.employeeId);
    this.assertDateRange(dto.effectiveFrom, dto.effectiveTo, 'effectiveTo');
    return this.payrollTransaction(async (tx) => {
      await this.assertSalaryPeriodAvailable(dto.employeeId, dto.effectiveFrom, dto.effectiveTo, undefined, tx);
      const record = await tx.salaryRecord.create({
        data: {
          ...dto,
          baseSalary: nonNegativeMoney(dto.baseSalary, 'baseSalary', '1000000000'),
          hra: nonNegativeMoney(dto.hra ?? 0, 'hra', '1000000000'),
          conveyance: nonNegativeMoney(dto.conveyance ?? 0, 'conveyance', '1000000000'),
          mobile: nonNegativeMoney(dto.mobile ?? 0, 'mobile', '1000000000'),
          food: nonNegativeMoney(dto.food ?? 0, 'food', '1000000000'),
          fuel: nonNegativeMoney(dto.fuel ?? 0, 'fuel', '1000000000'),
          other: nonNegativeMoney(dto.other ?? 0, 'other', '1000000000'),
          grossAdjustment: money(dto.grossAdjustment ?? 0, 'grossAdjustment'),
          allowances: nonNegativeMoney(dto.allowances ?? 0, 'allowances', '1000000000'),
          deductions: nonNegativeMoney(dto.deductions ?? 0, 'deductions', '1000000000'),
          bonuses: nonNegativeMoney(dto.bonuses ?? 0, 'bonuses', '1000000000'),
          taxRate: nonNegativeMoney(dto.taxRate ?? 0, 'taxRate', '100'),
        }, include: salaryRecordInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, resourceType: 'SalaryRecord', resourceId: record.id, summary: 'Salary record created', subjectEmployeeId: dto.employeeId, after: record });
      return record;
    });
  }

  async listSalaryRecords(query: QuerySalaryRecordsDto, user: RequestUser) {
    const filters: Prisma.SalaryRecordWhereInput[] = [this.salaryAccessWhere(user)];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    const { page, limit, ...args } = listArgs(query, { allowedSortFields: ['createdAt', 'effectiveFrom', 'baseSalary'], defaultSortBy: 'effectiveFrom', where: { AND: filters }, include: salaryRecordInclude });
    const [data, total] = await Promise.all([this.prisma.salaryRecord.findMany(args), this.prisma.salaryRecord.count({ where: args.where })]);
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, resourceType: 'SalaryRecord', summary: 'Compensation records viewed', permissionCode: 'payroll.read_compensation' });
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findSalaryRecordById(id: string, user: RequestUser) {
    const record = await this.prisma.salaryRecord.findFirst({ where: { AND: [{ id }, { deletedAt: null }, this.salaryAccessWhere(user)] }, include: salaryRecordInclude });
    if (!record) throw new NotFoundException('Salary record not found');
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, resourceType: 'SalaryRecord', resourceId: id, summary: 'Compensation record viewed', subjectEmployeeId: record.employeeId, permissionCode: 'payroll.read_compensation' });
    return record;
  }

  updateSalaryRecord(id: string, dto: UpdateSalaryRecordDto, user: RequestUser) {
    return this.payrollTransaction(async (tx) => {
      const record = await tx.salaryRecord.findFirst({ where: { id, deletedAt: null } });
      if (!record) throw new NotFoundException('Salary record not found');
      await this.authorization.assertEmployeeScope(user, record.employeeId, { all: 'payroll.configure' });
      const effectiveFrom = dto.effectiveFrom ?? record.effectiveFrom;
      const effectiveTo = dto.effectiveTo ?? record.effectiveTo ?? undefined;
      this.assertDateRange(effectiveFrom, effectiveTo, 'effectiveTo');
      await this.assertSalaryPeriodAvailable(record.employeeId, effectiveFrom, effectiveTo, id, tx);
      const updated = await tx.salaryRecord.update({
        where: { id },
        data: {
          ...dto,
          baseSalary: dto.baseSalary === undefined ? undefined : nonNegativeMoney(dto.baseSalary, 'baseSalary', '1000000000'),
          hra: dto.hra === undefined ? undefined : nonNegativeMoney(dto.hra, 'hra', '1000000000'),
          conveyance: dto.conveyance === undefined ? undefined : nonNegativeMoney(dto.conveyance, 'conveyance', '1000000000'),
          mobile: dto.mobile === undefined ? undefined : nonNegativeMoney(dto.mobile, 'mobile', '1000000000'),
          food: dto.food === undefined ? undefined : nonNegativeMoney(dto.food, 'food', '1000000000'),
          fuel: dto.fuel === undefined ? undefined : nonNegativeMoney(dto.fuel, 'fuel', '1000000000'),
          other: dto.other === undefined ? undefined : nonNegativeMoney(dto.other, 'other', '1000000000'),
          grossAdjustment: dto.grossAdjustment === undefined ? undefined : money(dto.grossAdjustment, 'grossAdjustment'),
          allowances: dto.allowances === undefined ? undefined : nonNegativeMoney(dto.allowances, 'allowances', '1000000000'),
          deductions: dto.deductions === undefined ? undefined : nonNegativeMoney(dto.deductions, 'deductions', '1000000000'),
          bonuses: dto.bonuses === undefined ? undefined : nonNegativeMoney(dto.bonuses, 'bonuses', '1000000000'),
          taxRate: dto.taxRate === undefined ? undefined : nonNegativeMoney(dto.taxRate, 'taxRate', '100'),
          version: { increment: 1 },
        }, include: salaryRecordInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, resourceType: 'SalaryRecord', resourceId: id, summary: 'Salary record updated', subjectEmployeeId: record.employeeId, before: record, after: updated });
      return updated;
    });
  }

  removeSalaryRecord(id: string, user: RequestUser) {
    return this.payrollTransaction(async (tx) => {
      const record = await this.ensureSalaryRecord(id, tx);
      await this.authorization.assertEmployeeScope(user, record.employeeId, { all: 'payroll.configure' });
      const used = await tx.payroll.findFirst({ where: { employeeId: record.employeeId, year: record.effectiveFrom.getUTCFullYear(), payrollRun: { status: { not: PayrollRunStatus.CANCELLED } } }, select: { id: true } });
      if (used) throw new BadRequestException('Salary records used by payroll history cannot be archived');
      const removed = await tx.salaryRecord.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } }, include: salaryRecordInclude });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, resourceType: 'SalaryRecord', resourceId: id, summary: 'Salary record archived', subjectEmployeeId: record.employeeId });
      return removed;
    });
  }

  generate(dto: GeneratePayrollDto, key: string | undefined, user: RequestUser) {
    const rule = this.authorization.scopeRule(user, 'payroll.generate', AccessScopeType.ALL_EMPLOYEES);
    if (dto.employeeId ? !this.authorization.permissionAllowedForScope(user, 'payroll.generate', AccessScopeType.ALL_EMPLOYEES, dto.employeeId) : !rule.unrestricted) throw new ForbiddenException('Payroll generation scope is not available');
    return this.generateInternal(dto, key, user);
  }

  async preflight(dto: GeneratePayrollDto, user: RequestUser) {
    const rule = this.authorization.scopeRule(user, 'payroll.generate', AccessScopeType.ALL_EMPLOYEES);
    if (dto.employeeId ? !this.authorization.permissionAllowedForScope(user, 'payroll.generate', AccessScopeType.ALL_EMPLOYEES, dto.employeeId) : !rule.unrestricted) throw new ForbiddenException('Payroll generation scope is not available');
    const prepared = await this.collectPayrollInputs(dto, this.prisma);
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, resourceType: 'PayrollPreflight', summary: 'Payroll preflight reviewed', payrollPeriod: `${dto.year}-${String(dto.month).padStart(2, '0')}`, metadata: { runType: prepared.runType, errors: prepared.issues.filter((issue) => issue.severity === 'ERROR').length, warnings: prepared.issues.filter((issue) => issue.severity === 'WARNING').length } });
    return this.presentPreflight(prepared);
  }

  async createAdjustment(dto: CreatePayrollAdjustmentDto, user: RequestUser) {
    await this.authorization.assertEmployeeScope(user, dto.employeeId, { all: 'payroll.generate' });
    await this.ensureEmployee(dto.employeeId);
    const amount = nonNegativeMoney(dto.amount, 'amount', '1000000000');
    if (amount.isZero()) throw new BadRequestException('amount must be greater than zero');
    return this.payrollTransaction(async (tx) => {
      const applied = await tx.payroll.findFirst({ where: { employeeId: dto.employeeId, year: dto.year, month: dto.month, payrollRun: { status: { in: [PayrollRunStatus.PUBLISHED, PayrollRunStatus.PAID] } } }, select: { id: true } });
      if (applied) throw new BadRequestException('Create a payroll correction instead of changing a published payroll period');
      const adjustment = await tx.payrollAdjustment.create({ data: { ...dto, amount, taxable: dto.taxable ?? false, createdByUserId: user.id } });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, resourceType: 'PayrollAdjustment', resourceId: adjustment.id, summary: 'Payroll adjustment created', reason: dto.reason, subjectEmployeeId: dto.employeeId, payrollPeriod: `${dto.year}-${String(dto.month).padStart(2, '0')}`, after: adjustment });
      return adjustment;
    });
  }

  async listAdjustments(query: QueryPayrollAdjustmentsDto, user: RequestUser) {
    const where: Prisma.PayrollAdjustmentWhereInput = {
      employeeId: query.employeeId,
      year: query.year,
      month: query.month,
      appliedPayrollId: query.applied === undefined ? undefined : query.applied ? { not: null } : null,
      employee: this.compensationEmployeeWhere(user),
    };
    const { page, limit, ...args } = listArgs(query, { allowedSortFields: ['createdAt', 'year', 'month', 'amount'], defaultSortBy: 'createdAt', where });
    const [data, total] = await Promise.all([this.prisma.payrollAdjustment.findMany(args), this.prisma.payrollAdjustment.count({ where: args.where })]);
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, resourceType: 'PayrollAdjustment', summary: 'Payroll adjustments viewed' });
    return { data, meta: paginationMeta(total, page, limit) };
  }

  private generateInternal(dto: GeneratePayrollDto, key: string | undefined, user: RequestUser, correctionOfId?: string, correctionReason?: string) {
    return this.payrollTransaction(async (tx) => {
      const operation = correctionOfId ? 'payroll.correction' : 'payroll.generate';
      const duplicate = await this.idempotentRun(tx, user, operation, key, { dto, correctionOfId, correctionReason });
      if (duplicate) return duplicate;
      const runType = dto.runType ?? PayrollRunType.REGULAR;
      this.assertRunShape(dto, runType);
      const existing = await tx.payrollRun.findFirst({ where: { year: dto.year, month: dto.month, runType, status: { not: PayrollRunStatus.CANCELLED } }, orderBy: { revision: 'desc' } });
      if (existing && existing.id !== correctionOfId) throw new ConflictException('An active payroll run already exists for this period');
      let correctionSource: Prisma.PayrollRunGetPayload<{ include: { payrolls: true } }> | null = null;
      if (correctionOfId) {
        correctionSource = await tx.payrollRun.findUnique({ where: { id: correctionOfId }, include: { payrolls: true } });
        if (!correctionSource) throw new NotFoundException('Payroll run not found');
        if (correctionSource.year !== dto.year || correctionSource.month !== dto.month) throw new BadRequestException('Correction period does not match the source run');
        if (correctionSource.runType !== runType) throw new BadRequestException('Correction type does not match the source run');
      }
      const prepared = await this.collectPayrollInputs(dto, tx, correctionSource?.payrolls.map((payroll) => payroll.id) ?? []);
      const errors = prepared.issues.filter((issue) => issue.severity === 'ERROR');
      if (errors.length) throw new BadRequestException(`Fix payroll preflight errors before generating: ${errors.slice(0, 5).map((issue) => issue.message).join(' | ')}`);
      if (correctionSource) {
        await tx.loanRepayment.updateMany({ where: { payrollId: { in: correctionSource.payrolls.map((item) => item.id) }, status: LoanRepaymentStatus.POSTED }, data: { status: LoanRepaymentStatus.REVERSED, reversedAt: new Date() } });
        await tx.payrollAdjustment.updateMany({ where: { appliedPayrollId: { in: correctionSource.payrolls.map((item) => item.id) } }, data: { appliedPayrollId: null } });
        await tx.payroll.updateMany({ where: { runId: correctionSource.id, revokedAt: null }, data: { revokedAt: new Date(), revokedByUserId: user.id, revocationReason: correctionReason } });
        await tx.payrollRun.update({ where: { id: correctionSource.id }, data: { status: PayrollRunStatus.CANCELLED, cancelledByUserId: user.id, cancelledAt: new Date(), cancellationReason: correctionReason, version: { increment: 1 } } });
      }
      const latestRevision = await tx.payrollRun.aggregate({ where: { year: dto.year, month: dto.month }, _max: { revision: true } });
      const run = await tx.payrollRun.create({ data: { year: dto.year, month: dto.month, revision: (latestRevision._max.revision ?? 0) + 1, runType, purpose: dto.purpose?.trim() || null, generatedByUserId: user.id, correctionOfId } });
      for (const calculated of prepared.calculations) {
        const record = await tx.payroll.create({ data: {
          runId: run.id, employeeId: calculated.employee.id, year: dto.year, month: dto.month,
          baseSalary: calculated.baseSalary, allowances: calculated.allowances, deductions: calculated.deductions, bonuses: calculated.bonuses,
          taxAmount: calculated.taxAmount, grossPay: calculated.grossPay, netPay: calculated.netPay,
          inputSnapshot: calculated.snapshot, calculationHash: calculated.calculationHash,
        } });
        if (calculated.lines.length) await tx.payrollLineItem.createMany({ data: calculated.lines.filter((line) => !line.amount.isZero()).map((line) => ({ payrollId: record.id, ...line })) });
        await this.loans.postPayrollDeductions(record.id, dto.year, dto.month, calculated.loanPlan.deductions, tx);
        if (calculated.adjustments.length) {
          const applied = await tx.payrollAdjustment.updateMany({ where: { id: { in: calculated.adjustments.map((adjustment) => adjustment.id) }, appliedPayrollId: null }, data: { appliedPayrollId: record.id } });
          if (applied.count !== calculated.adjustments.length) throw new ConflictException('A payroll adjustment was applied by another payroll operation');
        }
      }
      await this.audit.record(tx, user, {
        action: correctionOfId ? AuditAction.OVERRIDE : AuditAction.CREATE,
        resourceType: 'PayrollRun', resourceId: run.id, summary: correctionOfId ? 'Payroll correction generated' : 'Payroll run generated',
        reason: correctionReason, isOverride: Boolean(correctionOfId), workflowStatus: run.status, payrollPeriod: this.payrollPeriod(run), after: run,
        metadata: { runType, employeeCount: prepared.calculations.length, warnings: prepared.issues.filter((issue) => issue.severity === 'WARNING').length },
      });
      await this.saveIdempotency(tx, user, operation, key, { dto, correctionOfId, correctionReason }, 'PayrollRun', run.id);
      return this.presentRun(await tx.payrollRun.findUniqueOrThrow({ where: { id: run.id }, include: payrollRunInclude }));
    });
  }

  private async collectPayrollInputs(dto: GeneratePayrollDto, client: Prisma.TransactionClient | PrismaService, releaseAdjustmentPayrollIds: string[] = []): Promise<PayrollPreflight> {
    const runType = dto.runType ?? PayrollRunType.REGULAR;
    this.assertRunShape(dto, runType);
    const monthStart = new Date(Date.UTC(dto.year, dto.month - 1, 1));
    const monthEnd = new Date(Date.UTC(dto.year, dto.month, 0, 23, 59, 59, 999));
    const settings = await client.organizationSettings.findUnique({ where: { id: 'default' } });
    const policy = {
      prorationBasis: settings?.payrollProrationBasis === 'CALENDAR_DAYS' ? 'CALENDAR_DAYS' as const : 'FIXED_30' as const,
      requireBankDetails: settings?.payrollRequireBankDetails ?? true,
      requireAttendance: settings?.payrollRequireAttendance ?? false,
      varianceThreshold: settings?.payrollVarianceThreshold ?? new Prisma.Decimal(25),
      financialPolicyVersion: settings?.financialPolicyVersion ?? 1,
    };
    const employees = await client.employee.findMany({
      where: {
        deletedAt: null,
        employmentStatus: { in: [EmploymentStatus.ACTIVE, EmploymentStatus.ON_LEAVE, EmploymentStatus.PROBATION] },
        hireDate: { lte: monthEnd },
        id: dto.employeeId,
      },
      include: {
        bankAccount: { select: { bankCode: true, iban: true, accountNumber: true } },
        profile: { select: { wpsSponsor: true } },
        credentials: { where: { deletedAt: null, type: 'QID' }, select: { type: true, number: true } },
        salaryRecords: { where: { deletedAt: null, effectiveFrom: { lte: monthEnd }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: monthStart } }] }, orderBy: { effectiveFrom: 'asc' } },
      },
    });
    const issues: PayrollIssue[] = [];
    if (!employees.length) issues.push({ severity: 'ERROR', code: 'NO_ELIGIBLE_EMPLOYEES', message: 'No eligible employees were found for this payroll period.' });
    const calculations: PayrollCalculation[] = [];
    for (const employee of employees) calculations.push(await this.calculateEmployeePayroll(employee, dto, runType, monthStart, monthEnd, policy, client, releaseAdjustmentPayrollIds));
    for (const calculation of calculations) issues.push(...calculation.issues);
    return { year: dto.year, month: dto.month, runType, purpose: dto.purpose?.trim() || undefined, calculations, issues, policy };
  }

  private async calculateEmployeePayroll(
    employee: CalculationEmployee,
    dto: GeneratePayrollDto,
    runType: PayrollRunType,
    monthStart: Date,
    monthEnd: Date,
    policy: PayrollPreflight['policy'],
    client: Prisma.TransactionClient | PrismaService,
    releaseAdjustmentPayrollIds: string[],
  ): Promise<PayrollCalculation> {
    const issues: PayrollIssue[] = [];
    const employeeIssue = (severity: PayrollIssue['severity'], code: string, message: string) => issues.push({ severity, code, message, employeeId: employee.id, employeeCode: employee.employeeCode });
    const payableStart = this.dayStart(employee.hireDate > monthStart ? employee.hireDate : monthStart);
    const payableEnd = this.dayStart(monthEnd);
    const monthDays = this.inclusiveDays(monthStart, monthEnd);
    const records = employee.salaryRecords;
    const sourceByDay = new Map<string, SalarySource>();
    for (const day of this.eachDay(payableStart, payableEnd)) sourceByDay.set(this.dateKey(day), this.salarySourceForDay(employee, records, day));
    const groupedSources = new Map<string, { source: SalarySource; days: number }>();
    for (const source of sourceByDay.values()) {
      const current = groupedSources.get(source.id);
      if (current) current.days += 1; else groupedSources.set(source.id, { source, days: 1 });
    }
    const fullMonthlyEntitlement = this.dateKey(payableStart) === this.dateKey(monthStart) && groupedSources.size === 1 && [...groupedSources.values()][0].days === monthDays;
    let baseSalary = ZERO_MONEY; let allowances = ZERO_MONEY; let bonuses = ZERO_MONEY; let fixedDeductions = ZERO_MONEY; let taxAmount = ZERO_MONEY;
    const allowanceLines = new Map<string, Prisma.Decimal>();
    for (const group of groupedSources.values()) {
      const divisor = policy.prorationBasis === 'CALENDAR_DAYS' ? monthDays : 30;
      const factor = fullMonthlyEntitlement ? new Prisma.Decimal(1) : new Prisma.Decimal(group.days).div(divisor);
      const sourceBase = money(group.source.baseSalary.times(factor), 'baseSalary');
      const sourceAllowances = money(group.source.allowances.times(factor), 'allowances');
      const sourceBonuses = money(group.source.bonuses.times(factor), 'bonuses');
      const sourceDeductions = money(group.source.deductions.times(factor), 'deductions');
      baseSalary = sumMoney([baseSalary, sourceBase]); allowances = sumMoney([allowances, sourceAllowances]); bonuses = sumMoney([bonuses, sourceBonuses]); fixedDeductions = sumMoney([fixedDeductions, sourceDeductions]);
      taxAmount = sumMoney([taxAmount, percentageMoney(sumMoney([sourceBase, sourceAllowances, sourceBonuses]), group.source.taxRate)]);
      for (const line of group.source.allowanceLines) allowanceLines.set(line.description, sumMoney([allowanceLines.get(line.description) ?? ZERO_MONEY, money(line.amount.times(factor), line.description)]));
    }
    const adjustmentWhere: Prisma.PayrollAdjustmentWhereInput = {
      employeeId: employee.id, year: dto.year, month: dto.month,
      OR: [{ appliedPayrollId: null }, ...(releaseAdjustmentPayrollIds.length ? [{ appliedPayrollId: { in: releaseAdjustmentPayrollIds } }] : [])],
    };
    const storedAdjustments = await client.payrollAdjustment.findMany({ where: adjustmentWhere, orderBy: { createdAt: 'asc' } });
    const adjustments = storedAdjustments.map((adjustment) => ({ id: adjustment.id, direction: adjustment.direction, amount: adjustment.amount, taxable: adjustment.taxable, description: adjustment.description, reason: adjustment.reason }));
    const earningAdjustments = sumMoney(adjustments.filter((adjustment) => adjustment.direction === PayrollAdjustmentDirection.EARNING).map((adjustment) => adjustment.amount));
    const deductionAdjustments = sumMoney(adjustments.filter((adjustment) => adjustment.direction === PayrollAdjustmentDirection.DEDUCTION).map((adjustment) => adjustment.amount));
    if (runType === PayrollRunType.OFF_CYCLE) {
      baseSalary = ZERO_MONEY; allowances = ZERO_MONEY; bonuses = ZERO_MONEY; fixedDeductions = ZERO_MONEY; taxAmount = ZERO_MONEY; allowanceLines.clear();
      if (!adjustments.length) employeeIssue('ERROR', 'OFF_CYCLE_ADJUSTMENT_REQUIRED', `${employee.employeeCode} needs at least one approved adjustment for an off-cycle run.`);
    }
    const taxableAdjustments = sumMoney(adjustments.filter((adjustment) => adjustment.direction === PayrollAdjustmentDirection.EARNING && adjustment.taxable).map((adjustment) => adjustment.amount));
    const taxSource = sourceByDay.get(this.dateKey(payableEnd)) ?? this.salarySourceForDay(employee, records, payableEnd);
    taxAmount = sumMoney([taxAmount, percentageMoney(taxableAdjustments, taxSource.taxRate)]);
    const lopValues = runType === PayrollRunType.REGULAR ? await this.payrollLopDayValues(employee.id, monthStart, monthEnd, client) : new Map<string, Prisma.Decimal>();
    let lopDays = ZERO_MONEY; let lopAmount = ZERO_MONEY;
    for (const [date, value] of lopValues) {
      if (date < this.dateKey(payableStart)) continue;
      const salary = sourceByDay.get(date) ?? this.salarySourceForDay(employee, records, new Date(`${date}T00:00:00.000Z`));
      const divisor = policy.prorationBasis === 'CALENDAR_DAYS' ? monthDays : 30;
      lopDays = sumMoney([lopDays, value]);
      lopAmount = sumMoney([lopAmount, money(salary.baseSalary.div(divisor).times(value), 'loss of pay')]);
    }
    const loanPlan = runType === PayrollRunType.REGULAR ? await this.loans.preparePayrollDeductions(employee.id, dto.year, dto.month, client as Prisma.TransactionClient) : { deductions: [], total: ZERO_MONEY };
    const grossPay = sumMoney([baseSalary, allowances, bonuses, earningAdjustments]);
    const deductions = sumMoney([fixedDeductions, lopAmount, loanPlan.total, deductionAdjustments]);
    const rawNetPay = grossPay.minus(deductions).minus(taxAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const netPay = Prisma.Decimal.max(ZERO_MONEY, rawNetPay);
    if (grossPay.lte(0)) employeeIssue('ERROR', 'NON_POSITIVE_GROSS_PAY', `${employee.employeeCode} has no positive gross pay for ${this.payrollPeriod(dto)}.`);
    if (rawNetPay.isNegative()) employeeIssue('ERROR', 'NEGATIVE_NET_PAY', `${employee.employeeCode} would have a negative net pay of ${rawNetPay.toFixed(2)}.`);
    else if (netPay.isZero()) employeeIssue('WARNING', 'ZERO_NET_PAY', `${employee.employeeCode} has a zero net pay.`);
    if (!records.length && employee.salary.lte(0)) employeeIssue('ERROR', 'MISSING_SALARY', `${employee.employeeCode} has no effective salary record or legacy salary.`);
    if (policy.requireBankDetails && (!employee.bankAccount?.bankCode || !(employee.bankAccount.iban || employee.bankAccount.accountNumber))) employeeIssue('ERROR', 'MISSING_BANK_DETAILS', `${employee.employeeCode} is missing a bank code and IBAN or account number.`);
    if (!employee.credentials.some((credential) => credential.number)) employeeIssue('WARNING', 'MISSING_QID', `${employee.employeeCode} is missing a QID; a WPS bank file cannot be released until it is supplied.`);
    const attendanceCount = runType === PayrollRunType.REGULAR ? await client.attendance.count({ where: { employeeId: employee.id, deletedAt: null, attendanceDate: { gte: monthStart, lte: monthEnd } } }) : 1;
    if (!attendanceCount) employeeIssue(policy.requireAttendance ? 'ERROR' : 'WARNING', 'MISSING_ATTENDANCE', `${employee.employeeCode} has no attendance records for the payroll period.`);
    if (runType === PayrollRunType.REGULAR) {
      const prior = await client.payroll.findFirst({ where: { employeeId: employee.id, revokedAt: null, payrollRun: { status: { in: [PayrollRunStatus.PUBLISHED, PayrollRunStatus.PAID] } } }, select: { netPay: true, year: true, month: true }, orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }] });
      if (prior?.netPay.gt(0)) {
        const variance = netPay.minus(prior.netPay).abs().div(prior.netPay).times(100);
        if (variance.gt(policy.varianceThreshold)) employeeIssue('WARNING', 'NET_PAY_VARIANCE', `${employee.employeeCode} net pay changes ${variance.toFixed(2)}% from ${prior.year}-${String(prior.month).padStart(2, '0')}.`);
      }
    }
    const lines = [
      { kind: PayrollLineKind.BASE_SALARY, description: 'Base salary', amount: baseSalary },
      ...[...allowanceLines.entries()].map(([description, amount]) => ({ kind: PayrollLineKind.ALLOWANCE, description, amount })),
      ...(allowanceLines.size ? [] : [{ kind: PayrollLineKind.ALLOWANCE, description: 'Allowances', amount: allowances }]),
      { kind: PayrollLineKind.BONUS, description: 'Bonuses', amount: bonuses },
      ...adjustments.map((adjustment) => ({ kind: PayrollLineKind.MANUAL_ADJUSTMENT, description: `${adjustment.direction === PayrollAdjustmentDirection.EARNING ? 'Earning' : 'Deduction'} adjustment: ${adjustment.description}`, amount: adjustment.amount })),
      { kind: PayrollLineKind.FIXED_DEDUCTION, description: 'Fixed deductions', amount: fixedDeductions },
      { kind: PayrollLineKind.LOSS_OF_PAY, description: `Loss of pay (${lopDays.toFixed(2)} days)`, amount: lopAmount },
      { kind: PayrollLineKind.TAX, description: 'Tax deduction', amount: taxAmount },
    ];
    const snapshot = {
      schemaVersion: 1,
      payrollPeriod: this.payrollPeriod(dto), runType, policy: { ...policy, varianceThreshold: policy.varianceThreshold.toFixed(2) },
      employee: { id: employee.id, employeeCode: employee.employeeCode, hireDate: this.dateKey(employee.hireDate), salary: employee.salary.toFixed(2) },
      salaryRecords: records.map((record) => ({ id: record.id, version: record.version, effectiveFrom: this.dateKey(record.effectiveFrom), effectiveTo: record.effectiveTo ? this.dateKey(record.effectiveTo) : null, baseSalary: record.baseSalary.toFixed(2), hra: record.hra.toFixed(2), conveyance: record.conveyance.toFixed(2), mobile: record.mobile.toFixed(2), food: record.food.toFixed(2), fuel: record.fuel.toFixed(2), other: record.other.toFixed(2), grossAdjustment: record.grossAdjustment.toFixed(2), allowances: record.allowances.toFixed(2), deductions: record.deductions.toFixed(2), bonuses: record.bonuses.toFixed(2), taxRate: record.taxRate.toFixed(2) })),
      lop: { days: lopDays.toFixed(2), amount: lopAmount.toFixed(2) },
      loans: loanPlan.deductions.map((item) => ({ loanId: item.loanId, amount: item.amount.toFixed(2) })),
      adjustments: adjustments.map((adjustment) => ({ ...adjustment, amount: adjustment.amount.toFixed(2) })),
      result: { baseSalary: baseSalary.toFixed(2), allowances: allowances.toFixed(2), bonuses: bonuses.toFixed(2), deductions: deductions.toFixed(2), taxAmount: taxAmount.toFixed(2), grossPay: grossPay.toFixed(2), netPay: netPay.toFixed(2) },
    } as Prisma.InputJsonValue;
    return { employee, baseSalary, allowances, bonuses, fixedDeductions, taxAmount, grossPay, deductions, rawNetPay, netPay, lopDays, lopAmount, loanPlan, adjustments, lines, snapshot, calculationHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), issues };
  }

  private salarySourceForDay(employee: CalculationEmployee, records: CalculationSalaryRecord[], date: Date): SalarySource {
    const record = records.find((candidate) => candidate.effectiveFrom <= date && (!candidate.effectiveTo || candidate.effectiveTo >= date)) ?? null;
    const detailed = record ? [
      ['Housing allowance', record.hra], ['Conveyance allowance', record.conveyance], ['Mobile allowance', record.mobile], ['Food allowance', record.food], ['Fuel allowance', record.fuel], ['Other allowance', record.other], ['Gross adjustment', record.grossAdjustment],
    ] as const : [];
    const hasDetailedComponents = detailed.some(([, amount]) => !amount.isZero());
    const legacyAllowances = record && !hasDetailedComponents ? record.allowances : ZERO_MONEY;
    const allowanceLines = [...detailed.filter(([, amount]) => !amount.isZero()).map(([description, amount]) => ({ description, amount })), ...(legacyAllowances.isZero() ? [] : [{ description: 'Allowances', amount: legacyAllowances }])];
    return {
      id: record?.id ?? 'legacy-salary', version: record?.version ?? 0, record,
      baseSalary: nonNegativeMoney(record?.baseSalary ?? employee.salary, 'baseSalary'),
      allowances: sumMoney(allowanceLines.map((line) => line.amount)),
      bonuses: nonNegativeMoney(record?.bonuses ?? 0, 'bonuses'), deductions: nonNegativeMoney(record?.deductions ?? 0, 'deductions'), taxRate: nonNegativeMoney(record?.taxRate ?? 0, 'taxRate', '100'), allowanceLines,
    };
  }

  private presentPreflight(preflight: PayrollPreflight) {
    const count = (severity: PayrollIssue['severity']) => preflight.issues.filter((issue) => issue.severity === severity).length;
    const sum = (field: keyof Pick<PayrollCalculation, 'grossPay' | 'deductions' | 'netPay'>) => sumMoney(preflight.calculations.map((calculation) => calculation[field]));
    return {
      year: preflight.year, month: preflight.month, runType: preflight.runType, purpose: preflight.purpose,
      ready: count('ERROR') === 0,
      policy: { prorationBasis: preflight.policy.prorationBasis, requireBankDetails: preflight.policy.requireBankDetails, requireAttendance: preflight.policy.requireAttendance, varianceThreshold: preflight.policy.varianceThreshold.toFixed(2), financialPolicyVersion: preflight.policy.financialPolicyVersion },
      summary: { employees: preflight.calculations.length, errors: count('ERROR'), warnings: count('WARNING'), grossPay: sum('grossPay').toFixed(2), deductions: sum('deductions').toFixed(2), netPay: sum('netPay').toFixed(2), adjustments: preflight.calculations.reduce((countAdjustments, calculation) => countAdjustments + calculation.adjustments.length, 0) },
      issues: preflight.issues,
      employees: preflight.calculations.map((calculation) => ({ employeeId: calculation.employee.id, employeeCode: calculation.employee.employeeCode, name: `${calculation.employee.firstName} ${calculation.employee.lastName}`, grossPay: calculation.grossPay.toFixed(2), deductions: calculation.deductions.plus(calculation.taxAmount).toFixed(2), netPay: calculation.netPay.toFixed(2), lopDays: calculation.lopDays.toFixed(2), calculationHash: calculation.calculationHash, issues: calculation.issues })),
    };
  }

  private assertRunShape(dto: GeneratePayrollDto, runType: PayrollRunType) {
    if (runType === PayrollRunType.OFF_CYCLE && (!dto.employeeId || !dto.purpose?.trim() || dto.purpose.trim().length < 3)) throw new BadRequestException('Off-cycle payroll requires one employee and a purpose of at least three characters');
  }

  async listRuns(query: QueryPayrollDto, user: RequestUser) {
    const page = query.page ?? 1; const limit = query.limit ?? 20;
    const where: Prisma.PayrollRunWhereInput = { AND: [this.runAccessWhere(user, ['payroll.read', 'payroll.audit.read']), { year: query.year, month: query.month, status: query.status, payrolls: query.departmentId ? { some: { employee: { departmentId: query.departmentId } } } : undefined }] };
    const [data, total] = await Promise.all([
      this.prisma.payrollRun.findMany({ where, include: { generatedBy: { select: { id: true, email: true } }, approvedBy: { select: { id: true, email: true } }, _count: { select: { payrolls: true } } }, orderBy: [{ year: 'desc' }, { month: 'desc' }, { revision: 'desc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.payrollRun.count({ where }),
    ]);
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, resourceType: 'PayrollRun', summary: 'Payroll runs viewed', permissionCode: 'payroll.read' });
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findRun(id: string, user: RequestUser) {
    this.assertRunPermission(user, ['payroll.read', 'payroll.audit.read'], id);
    const run = await this.prisma.payrollRun.findUnique({ where: { id }, include: payrollRunInclude });
    if (!run) throw new NotFoundException('Payroll run not found');
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, resourceType: 'PayrollRun', resourceId: id, summary: 'Payroll run viewed', permissionCode: 'payroll.read', workflowStatus: run.status, payrollPeriod: this.payrollPeriod(run) });
    return this.presentRun(run);
  }

  submit(id: string, dto: PayrollTransitionDto, key: string | undefined, user: RequestUser) {
    this.assertRunPermission(user, ['payroll.generate'], id);
    return this.transitionRun(id, PayrollRunStatus.GENERATED, PayrollRunStatus.PENDING_APPROVAL, dto, key, user, 'payroll.submit');
  }

  approve(id: string, dto: PayrollTransitionDto, key: string | undefined, user: RequestUser) {
    this.assertRunPermission(user, ['payroll.approve'], id);
    return this.payrollTransaction(async (tx) => {
      const duplicate = await this.idempotentRun(tx, user, 'payroll.approve', key, { id, dto }); if (duplicate) return duplicate;
      const run = await this.ensureRun(id, tx); this.assertVersion(run.version, dto.expectedVersion);
      if (run.status !== PayrollRunStatus.PENDING_APPROVAL) throw new BadRequestException('Only submitted payroll can be approved');
      if (run.generatedByUserId === user.id) throw new ForbiddenException('Payroll generator cannot approve the same run');
      const updated = await tx.payrollRun.update({ where: { id }, data: { status: PayrollRunStatus.APPROVED, approvedByUserId: user.id, approvedAt: new Date(), version: { increment: 1 } }, include: payrollRunInclude });
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, resourceType: 'PayrollRun', resourceId: id, summary: 'Payroll run approved', reason: dto.reason, workflowStatus: PayrollRunStatus.APPROVED, payrollPeriod: this.payrollPeriod(run), changes: [{ field: 'status', previousValue: run.status, nextValue: PayrollRunStatus.APPROVED }] });
      await this.saveIdempotency(tx, user, 'payroll.approve', key, { id, dto }, 'PayrollRun', id); return this.presentRun(updated);
    });
  }

  async publish(id: string, dto: PayrollTransitionDto, key: string | undefined, user: RequestUser) {
    this.assertRunPermission(user, ['payroll.publish'], id);
    this.validateIdempotencyKey(key);
    const existing = await this.prisma.idempotencyRecord.findUnique({ where: { actorUserId_operation_key: { actorUserId: user.id, operation: 'payroll.publish', key } } });
    if (existing) {
      if (existing.requestHash !== this.requestHash({ id, dto })) throw new ConflictException('Idempotency key was already used with a different request');
      return this.findRun(existing.resourceId, user);
    }
    const run = await this.prisma.payrollRun.findUnique({ where: { id }, include: payrollRunInclude });
    if (!run) throw new NotFoundException('Payroll run not found');
    this.assertVersion(run.version, dto.expectedVersion);
    if (run.status !== PayrollRunStatus.APPROVED) throw new BadRequestException('Only approved payroll can be published');
    const uploads = new Map<string, Awaited<ReturnType<DocumentStorageService['uploadPrivate']>>>();
    for (const payroll of run.payrolls) {
      const buffer = this.payslipPdf(payroll, run);
      const uploaded = await this.storage.uploadPrivate(`payroll/${run.year}/${String(run.month).padStart(2, '0')}/run-${run.id}`, `${payroll.id}.pdf`, 'application/pdf', buffer, { payrollId: payroll.id, employeeId: payroll.employeeId, runId: run.id });
      uploads.set(payroll.id, uploaded);
    }
    return this.payrollTransaction(async (tx) => {
      const duplicate = await this.idempotentRun(tx, user, 'payroll.publish', key, { id, dto }); if (duplicate) return duplicate;
      const current = await this.ensureRun(id, tx); this.assertVersion(current.version, dto.expectedVersion);
      if (current.status !== PayrollRunStatus.APPROVED) throw new ConflictException('Payroll run changed; refresh and retry');
      for (const [payrollId, upload] of uploads) await tx.payroll.update({ where: { id: payrollId }, data: { objectName: upload.objectName, objectGeneration: upload.generation, contentType: 'application/pdf', sizeBytes: upload.sizeBytes, sha256: upload.sha256 } });
      const updated = await tx.payrollRun.update({ where: { id }, data: { status: PayrollRunStatus.PUBLISHED, publishedByUserId: user.id, publishedAt: new Date(), version: { increment: 1 } }, include: payrollRunInclude });
      await tx.notification.createMany({ data: updated.payrolls.flatMap((payroll) => payroll.employee.userId ? [{ userId: payroll.employee.userId, type: 'PAYSLIP_PUBLISHED', title: 'Payslip available', message: `Your ${run.year}-${String(run.month).padStart(2, '0')} payslip is available.`, resourceType: 'Payroll', resourceId: payroll.id }] : []) });
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, resourceType: 'PayrollRun', resourceId: id, summary: 'Payroll run published', reason: dto.reason, workflowStatus: PayrollRunStatus.PUBLISHED, payrollPeriod: this.payrollPeriod(current), changes: [{ field: 'status', previousValue: current.status, nextValue: PayrollRunStatus.PUBLISHED }] });
      await this.saveIdempotency(tx, user, 'payroll.publish', key, { id, dto }, 'PayrollRun', id); return this.presentRun(updated);
    });
  }

  markPaid(id: string, dto: MarkPayrollPaidDto, key: string | undefined, user: RequestUser) {
    this.assertRunPermission(user, ['payroll.mark_paid'], id);
    return this.payrollTransaction(async (tx) => {
      const duplicate = await this.idempotentRun(tx, user, 'payroll.mark-paid', key, { id, dto }); if (duplicate) return duplicate;
      const run = await this.ensureRun(id, tx); this.assertVersion(run.version, dto.expectedVersion);
      if (run.status !== PayrollRunStatus.PUBLISHED) throw new BadRequestException('Only published payroll can be marked paid');
      const now = new Date();
      await tx.payroll.updateMany({ where: { runId: id, revokedAt: null }, data: { paymentStatus: PayrollPaymentStatus.PAID, paymentReference: dto.paymentBatchReference.trim(), paymentReconciledAt: now, paymentFailureReason: null } });
      const updated = await tx.payrollRun.update({ where: { id }, data: { status: PayrollRunStatus.PAID, paymentBatchReference: dto.paymentBatchReference.trim(), paidByUserId: user.id, paidAt: now, version: { increment: 1 } }, include: payrollRunInclude });
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, resourceType: 'PayrollRun', resourceId: id, summary: 'Payroll payment batch reconciled', reason: dto.reason, workflowStatus: PayrollRunStatus.PAID, payrollPeriod: this.payrollPeriod(run), changes: [{ field: 'status', previousValue: run.status, nextValue: PayrollRunStatus.PAID }], metadata: { paymentBatchReference: dto.paymentBatchReference.trim(), reconciliation: 'bulk-paid' } });
      await this.saveIdempotency(tx, user, 'payroll.mark-paid', key, { id, dto }, 'PayrollRun', id); return this.presentRun(updated);
    });
  }

  reconcilePayments(id: string, dto: ReconcilePayrollPaymentsDto, key: string | undefined, user: RequestUser) {
    this.assertRunPermission(user, ['payroll.mark_paid'], id);
    return this.payrollTransaction(async (tx) => {
      const duplicate = await this.idempotentRun(tx, user, 'payroll.reconcile-payments', key, { id, dto }); if (duplicate) return duplicate;
      const run = await this.ensureRun(id, tx); this.assertVersion(run.version, dto.expectedVersion);
      if (run.status !== PayrollRunStatus.PUBLISHED) throw new BadRequestException('Only published payroll can be reconciled');
      const payrolls = await tx.payroll.findMany({ where: { runId: id, revokedAt: null }, select: { id: true } });
      const ids = new Set(payrolls.map((payroll) => payroll.id));
      if (new Set(dto.payments.map((payment) => payment.payrollId)).size !== dto.payments.length || dto.payments.some((payment) => !ids.has(payment.payrollId))) throw new BadRequestException('Payment reconciliation contains an invalid or duplicate payslip');
      const now = new Date();
      for (const payment of dto.payments) {
        if (payment.status === PayrollPaymentStatus.FAILED && !payment.failureReason?.trim()) throw new BadRequestException('A failure reason is required for failed payments');
        await tx.payroll.update({ where: { id: payment.payrollId }, data: { paymentStatus: payment.status, paymentReference: payment.paymentReference?.trim() || dto.paymentBatchReference.trim(), paymentReconciledAt: now, paymentFailureReason: payment.status === PayrollPaymentStatus.FAILED ? payment.failureReason!.trim() : null } });
      }
      const remaining = await tx.payroll.count({ where: { runId: id, revokedAt: null, paymentStatus: { not: PayrollPaymentStatus.PAID } } });
      const updated = await tx.payrollRun.update({ where: { id }, data: remaining ? { paymentBatchReference: dto.paymentBatchReference.trim(), version: { increment: 1 } } : { status: PayrollRunStatus.PAID, paymentBatchReference: dto.paymentBatchReference.trim(), paidByUserId: user.id, paidAt: now, version: { increment: 1 } }, include: payrollRunInclude });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, resourceType: 'PayrollRun', resourceId: id, summary: remaining ? 'Payroll payment reconciliation updated' : 'Payroll payment reconciliation completed', reason: dto.reason, workflowStatus: updated.status, payrollPeriod: this.payrollPeriod(run), metadata: { paymentBatchReference: dto.paymentBatchReference.trim(), paymentCount: dto.payments.length, remainingUnpaid: remaining } });
      await this.saveIdempotency(tx, user, 'payroll.reconcile-payments', key, { id, dto }, 'PayrollRun', id);
      return this.presentRun(updated);
    });
  }

  cancel(id: string, dto: PayrollReasonTransitionDto, key: string | undefined, user: RequestUser) {
    this.assertRunPermission(user, ['payroll.generate'], id);
    return this.payrollTransaction(async (tx) => {
      const duplicate = await this.idempotentRun(tx, user, 'payroll.cancel', key, { id, dto }); if (duplicate) return duplicate;
      const run = await this.ensureRun(id, tx); this.assertVersion(run.version, dto.expectedVersion);
      if (([PayrollRunStatus.CANCELLED, PayrollRunStatus.PAID] as PayrollRunStatus[]).includes(run.status)) throw new BadRequestException('Paid or cancelled payroll cannot be cancelled');
      const payrolls = await tx.payroll.findMany({ where: { runId: id }, select: { id: true } });
      await tx.loanRepayment.updateMany({ where: { payrollId: { in: payrolls.map((item) => item.id) }, status: LoanRepaymentStatus.POSTED }, data: { status: LoanRepaymentStatus.REVERSED, reversedAt: new Date() } });
      await tx.payrollAdjustment.updateMany({ where: { appliedPayrollId: { in: payrolls.map((item) => item.id) } }, data: { appliedPayrollId: null } });
      await tx.payroll.updateMany({ where: { runId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedByUserId: user.id, revocationReason: dto.reason } });
      const updated = await tx.payrollRun.update({ where: { id }, data: { status: PayrollRunStatus.CANCELLED, cancelledByUserId: user.id, cancelledAt: new Date(), cancellationReason: dto.reason, version: { increment: 1 } }, include: payrollRunInclude });
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, resourceType: 'PayrollRun', resourceId: id, summary: 'Payroll run cancelled', reason: dto.reason, workflowStatus: PayrollRunStatus.CANCELLED, payrollPeriod: this.payrollPeriod(run), changes: [{ field: 'status', previousValue: run.status, nextValue: PayrollRunStatus.CANCELLED }] });
      await this.saveIdempotency(tx, user, 'payroll.cancel', key, { id, dto }, 'PayrollRun', id); return this.presentRun(updated);
    });
  }

  async correct(id: string, dto: PayrollReasonTransitionDto, key: string | undefined, user: RequestUser) {
    this.assertRunPermission(user, ['payroll.override'], id);
    this.authorization.requireRecentStepUp(user);
    const source = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!source) throw new NotFoundException('Payroll run not found');
    this.assertVersion(source.version, dto.expectedVersion);
    return this.generateInternal({ year: source.year, month: source.month, runType: source.runType, purpose: source.purpose ?? undefined }, key, user, source.id, dto.reason);
  }

  async listMyPayslips(query: QueryPayrollDto, user: RequestUser) {
    if (!user.employeeId) return { data: [], meta: paginationMeta(0, query.page ?? 1, query.limit ?? 20) };
    return this.listPayslipsInternal(query, user, { employeeId: user.employeeId, revokedAt: null, payrollRun: { status: { in: [PayrollRunStatus.PUBLISHED, PayrollRunStatus.PAID] } } });
  }

  async listPayslips(query: QueryPayrollDto, user: RequestUser) {
    if (!this.authorization.hasAny(user, ['payroll.read', 'payroll.audit.read', 'payroll.payslip.read_all'])) return this.listMyPayslips(query, user);
    return this.listPayslipsInternal(query, user, this.payrollAccessWhere(user));
  }

  private async listPayslipsInternal(query: QueryPayrollDto, user: RequestUser, base: Prisma.PayrollWhereInput) {
    const filters: Prisma.PayrollWhereInput[] = [base];
    if (query.employeeId) filters.push({ employeeId: query.employeeId }); if (query.year) filters.push({ year: query.year }); if (query.month) filters.push({ month: query.month });
    if (query.status) filters.push({ payrollRun: { status: query.status } }); if (query.departmentId) filters.push({ employee: { departmentId: query.departmentId } });
    const { page, limit, ...args } = listArgs(query, { allowedSortFields: ['createdAt', 'year', 'month', 'grossPay', 'netPay'], defaultSortBy: 'createdAt', where: { AND: filters }, include: payrollInclude, softDelete: false });
    const [data, total] = await Promise.all([this.prisma.payroll.findMany(args), this.prisma.payroll.count({ where: args.where })]);
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, resourceType: 'Payroll', summary: 'Payslips viewed' });
    return { data: (data as unknown as PayrollView[]).map((payroll) => this.presentPayroll(payroll)), meta: paginationMeta(total, page, limit) };
  }

  async listExportDepartments(user: RequestUser) {
    const departments = await this.prisma.department.findMany({
      where: { deletedAt: null, employees: { some: { payrolls: { some: {} } } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, resourceType: 'PayrollDepartment', summary: 'Payroll export departments viewed', permissionCode: 'payroll.export' });
    return departments;
  }

  async downloadPayslip(id: string, user: RequestUser) {
    const payroll = await this.prisma.payroll.findFirst({ where: { id, revokedAt: null, payrollRun: { status: { in: [PayrollRunStatus.PUBLISHED, PayrollRunStatus.PAID] } } }, include: { employee: { select: { id: true, employeeCode: true } } } });
    if (!payroll?.objectName) throw new NotFoundException('Payslip not found');
    const self = payroll.employeeId === user.employeeId && this.authorization.has(user, 'payroll.self.read_payslip');
    if (!self && !this.authorization.permissionAllowedForScope(user, 'payroll.pdf.download_all', AccessScopeType.ALL_EMPLOYEES, payroll.employeeId)) throw new NotFoundException('Payslip not found');
    const buffer = await this.storage.download(payroll.objectName, payroll.objectGeneration);
    if (payroll.sha256 && createHash('sha256').update(buffer).digest('hex') !== payroll.sha256) throw new ConflictException('Stored payslip integrity check failed');
    await this.audit.record(this.prisma, user, { action: AuditAction.DOWNLOAD, resourceType: 'Payroll', resourceId: payroll.id, summary: 'Payslip downloaded', subjectEmployeeId: payroll.employeeId });
    return { buffer, fileName: `payslip-${payroll.employee.employeeCode}-${payroll.year}-${String(payroll.month).padStart(2, '0')}.pdf` };
  }

  async exportRun(id: string, departmentId: string | undefined, user: RequestUser) {
    this.assertRunPermission(user, ['payroll.export'], id);
    const run = await this.prisma.payrollRun.findUnique({ where: { id }, include: { payrolls: { where: departmentId ? { employee: { departmentId } } : undefined, include: { employee: { select: { employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } } } } } } } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.payrolls.length > 10_000) throw new BadRequestException('Export is limited to 10,000 rows');
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = [['Employee Code', 'Employee', 'Department', 'Base Salary', 'Allowances', 'Bonuses', 'Deductions', 'Tax', 'Gross Pay', 'Net Pay'], ...run.payrolls.map((item) => [item.employee.employeeCode, `${item.employee.firstName} ${item.employee.lastName}`, item.employee.department?.name ?? '', item.baseSalary.toFixed(2), item.allowances.toFixed(2), item.bonuses.toFixed(2), item.deductions.toFixed(2), item.taxAmount.toFixed(2), item.grossPay.toFixed(2), item.netPay.toFixed(2)])];
    const buffer = Buffer.from(`\uFEFF${rows.map((row) => row.map(quote).join(',')).join('\r\n')}`, 'utf8');
    await this.audit.record(this.prisma, user, { action: AuditAction.EXPORT, resourceType: 'PayrollRun', resourceId: id, summary: departmentId ? 'Department payroll exported' : 'Payroll run exported', workflowStatus: run.status, payrollPeriod: this.payrollPeriod(run), metadata: { departmentId, recordCount: run.payrolls.length } });
    return { buffer, fileName: `payroll-${run.year}-${String(run.month).padStart(2, '0')}${departmentId ? '-department' : ''}.csv` };
  }

  async wpsPreflight(id: string, user: RequestUser) {
    this.assertRunPermission(user, ['payroll.mark_paid'], id);
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: {
        payrolls: {
          where: { revokedAt: null },
          include: {
            employee: {
              select: {
                employeeCode: true, firstName: true, lastName: true,
                bankAccount: { select: { bankCode: true, iban: true, accountNumber: true } },
                credentials: { where: { deletedAt: null, type: 'QID' }, select: { number: true } },
              },
            },
          },
        },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    const settings = await this.prisma.organizationSettings.findUnique({ where: { id: 'default' } });
    const errors: string[] = [];
    if (!settings?.wpsEmployerEid) errors.push('Organization WPS employer EID is missing.');
    if (!settings?.wpsPayerEid) errors.push('Organization WPS payer EID is missing.');
    if (!settings?.wpsPayerQid) errors.push('Organization WPS payer QID is missing.');
    if (!settings?.wpsPayerBank) errors.push('Organization WPS payer bank is missing.');
    if (!settings?.wpsPayerIban) errors.push('Organization WPS payer IBAN is missing.');
    for (const payroll of run.payrolls) {
      const { employee } = payroll;
      if (!employee.credentials.some((credential) => credential.number?.trim())) errors.push(`${employee.employeeCode} is missing a QID.`);
      if (!employee.bankAccount?.bankCode) errors.push(`${employee.employeeCode} is missing a bank code.`);
      if (!(employee.bankAccount?.iban || employee.bankAccount?.accountNumber)) errors.push(`${employee.employeeCode} is missing an IBAN or account number.`);
    }
    const payableStatuses: PayrollRunStatus[] = [PayrollRunStatus.APPROVED, PayrollRunStatus.PUBLISHED, PayrollRunStatus.PAID];
    const ready = errors.length === 0 && payableStatuses.includes(run.status);
    if (!ready && !errors.length) errors.push('Payroll must be approved before a payment file can be exported.');
    await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, resourceType: 'PayrollWpsPreflight', resourceId: id, summary: 'WPS payment file preflight reviewed', payrollPeriod: this.payrollPeriod(run), metadata: { errors: errors.length, status: run.status } });
    return { ready, runId: run.id, payrollPeriod: this.payrollPeriod(run), status: run.status, errors, notice: 'Validate this file with the company bank or WPS provider before first production use.' };
  }

  async exportWps(id: string, user: RequestUser) {
    const preflight = await this.wpsPreflight(id, user);
    if (!preflight.ready) throw new BadRequestException(`WPS payment file cannot be exported: ${preflight.errors.join(' | ')}`);
    const [run, settings] = await Promise.all([
      this.prisma.payrollRun.findUnique({
        where: { id },
        include: {
          payrolls: {
            where: { revokedAt: null },
            include: {
              employee: {
                select: {
                  employeeCode: true, firstName: true, lastName: true,
                  bankAccount: { select: { bankCode: true, iban: true, accountNumber: true } },
                  credentials: { where: { deletedAt: null, type: 'QID' }, select: { number: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.organizationSettings.findUnique({ where: { id: 'default' } }),
    ]);
    if (!run || !settings) throw new NotFoundException('Payroll run or organization settings not found');
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const now = new Date();
    const rows: Array<Array<string | number>> = [
      ['Employer Establishment ID (Employer EID)', 'File Creation Date', 'File Creation Time', 'Payer Establishment ID (Payer EID)', 'Payer QID', 'Payer Bank Short Name', 'Payer IBAN', 'Salary Year and Month', 'Total Salaries', 'Number of Records'],
      [settings.wpsEmployerEid!, `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`, `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`, settings.wpsPayerEid!, settings.wpsPayerQid!, settings.wpsPayerBank!, settings.wpsPayerIban!, `${run.year}${String(run.month).padStart(2, '0')}`, sumMoney(run.payrolls.map((payroll) => payroll.netPay)).toFixed(2), run.payrolls.length],
      ['Record Sequence', 'Employee QID', 'Employee Visa ID', 'Employee Name', 'Employee Bank Short Name', 'Employee Account', 'Salary Frequency', 'Number of Working days', 'Net Salary', 'Basic Salary', 'Extra hours', 'Extra income', 'Deductions', 'Payment Type', 'Notes / Comments'],
      ...run.payrolls.map((payroll, index) => [
        index + 1,
        payroll.employee.credentials.find((credential) => credential.number)?.number ?? '',
        '',
        `${payroll.employee.firstName} ${payroll.employee.lastName}`.trim(),
        payroll.employee.bankAccount?.bankCode ?? '',
        payroll.employee.bankAccount?.iban || payroll.employee.bankAccount?.accountNumber || '',
        'M',
        this.inclusiveDays(new Date(Date.UTC(run.year, run.month - 1, 1)), new Date(Date.UTC(run.year, run.month, 0))),
        payroll.netPay.toFixed(2), payroll.baseSalary.toFixed(2), payroll.bonuses.toFixed(2), payroll.allowances.toFixed(2), payroll.deductions.plus(payroll.taxAmount).toFixed(2), 'S',
        `Run ${run.id}`,
      ]),
    ];
    const buffer = Buffer.from(`\uFEFF${rows.map((row) => row.map(quote).join(',')).join('\r\n')}`, 'utf8');
    await this.audit.record(this.prisma, user, { action: AuditAction.EXPORT, resourceType: 'PayrollWpsFile', resourceId: id, summary: 'WPS payment file exported', payrollPeriod: this.payrollPeriod(run), metadata: { recordCount: run.payrolls.length, status: run.status } });
    return { buffer, fileName: `wps-payment-${run.year}-${String(run.month).padStart(2, '0')}-r${run.revision}.csv` };
  }

  private transitionRun(id: string, from: PayrollRunStatus, to: PayrollRunStatus, dto: PayrollTransitionDto, key: string | undefined, user: RequestUser, operation: string) {
    return this.payrollTransaction(async (tx) => {
      const duplicate = await this.idempotentRun(tx, user, operation, key, { id, dto }); if (duplicate) return duplicate;
      const run = await this.ensureRun(id, tx); this.assertVersion(run.version, dto.expectedVersion);
      if (run.status !== from) throw new BadRequestException(`Payroll run must be ${from.toLowerCase().replaceAll('_', ' ')}`);
      const updated = await tx.payrollRun.update({ where: { id }, data: { status: to, version: { increment: 1 } }, include: payrollRunInclude });
      await this.audit.record(tx, user, { action: AuditAction.TRANSITION, resourceType: 'PayrollRun', resourceId: id, summary: `Payroll run moved to ${to}`, reason: dto.reason, workflowStatus: to, payrollPeriod: this.payrollPeriod(run), changes: [{ field: 'status', previousValue: from, nextValue: to }] });
      await this.saveIdempotency(tx, user, operation, key, { id, dto }, 'PayrollRun', id); return this.presentRun(updated);
    });
  }

  private presentPayroll(payroll: PayrollView) {
    const { objectName: _objectName, objectGeneration: _objectGeneration, sha256: _sha256, ...view } = payroll;
    void _objectName; void _objectGeneration; void _sha256;
    return view;
  }

  private presentRun(run: PayrollRunView) {
    return { ...run, payrolls: run.payrolls.map((payroll) => {
      const { objectName: _objectName, objectGeneration: _objectGeneration, sha256: _sha256, ...view } = payroll;
      void _objectName; void _objectGeneration; void _sha256;
      return view;
    }) };
  }

  private payslipPdf(payroll: Prisma.PayrollGetPayload<{ include: { employee: { select: typeof employeePayrollSelect }; lineItems: true } }>, run: { year: number; month: number; revision: number }) {
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const safe = (value: string) => stripControlCharacters(value).slice(0, 200);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('Payslip', 40, 50);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`Employee: ${safe(`${payroll.employee.firstName} ${payroll.employee.lastName}`)}`, 40, 82);
    doc.text(`Employee code: ${safe(payroll.employee.employeeCode)}`, 40, 100);
    doc.text(`Period: ${run.year}-${String(run.month).padStart(2, '0')}  Revision: ${run.revision}`, 40, 118);
    doc.text(`Department: ${safe(payroll.employee.department?.name ?? 'N/A')}`, 40, 136);
    let y = 175; doc.setFont('helvetica', 'bold'); doc.text('Description', 40, y); doc.text('Amount', 480, y, { align: 'right' }); doc.line(40, y + 5, 500, y + 5); doc.setFont('helvetica', 'normal');
    for (const line of payroll.lineItems) { y += 22; doc.text(safe(line.description), 40, y); doc.text(line.amount.toFixed(2), 480, y, { align: 'right' }); }
    y += 35; doc.line(310, y - 15, 500, y - 15); doc.setFont('helvetica', 'bold');
    doc.text('Gross pay', 330, y); doc.text(payroll.grossPay.toFixed(2), 480, y, { align: 'right' });
    y += 20; doc.text('Total deductions', 330, y); doc.text(payroll.deductions.plus(payroll.taxAmount).toFixed(2), 480, y, { align: 'right' });
    y += 20; doc.text('Net pay', 330, y); doc.text(payroll.netPay.toFixed(2), 480, y, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text('System-generated payroll record', 40, 800);
    return Buffer.from(doc.output('arraybuffer'));
  }

  private async payrollLopDayValues(employeeId: string, monthStart: Date, monthEnd: Date, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const days = new Map<string, Prisma.Decimal>();
    const attendance = await client.attendance.findMany({ where: { employeeId, deletedAt: null, attendanceDate: { gte: monthStart, lte: monthEnd }, status: { in: [AttendanceStatus.ABSENT, AttendanceStatus.HALF_DAY] } }, select: { attendanceDate: true, status: true } });
    for (const record of attendance) days.set(this.dateKey(record.attendanceDate), new Prisma.Decimal(record.status === AttendanceStatus.ABSENT ? '1' : '0.5'));
    const unpaidLeaves = await client.leaveRequest.findMany({ where: { employeeId, deletedAt: null, status: LeaveRequestStatus.APPROVED, startDate: { lte: monthEnd }, endDate: { gte: monthStart }, leaveType: { isPaid: false } }, select: { startDate: true, endDate: true, totalDays: true } });
    for (const leave of unpaidLeaves) {
      const leaveStart = leave.startDate > monthStart ? leave.startDate : monthStart; const leaveEnd = leave.endDate < monthEnd ? leave.endDate : monthEnd;
      const perDay = Prisma.Decimal.min(1, leave.totalDays.div(this.inclusiveDays(leave.startDate, leave.endDate)));
      for (const date of this.eachDay(leaveStart, leaveEnd)) { const dateKey = this.dateKey(date); days.set(dateKey, Prisma.Decimal.max(days.get(dateKey) ?? ZERO_MONEY, perDay)); }
    }
    return days;
  }

  private async payrollLopDays(employeeId: string, monthStart: Date, monthEnd: Date, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    return sumMoney([...(await this.payrollLopDayValues(employeeId, monthStart, monthEnd, client)).values()]);
  }

  private *eachDay(start: Date, end: Date) { for (const day = this.dayStart(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) yield new Date(day); }
  private inclusiveDays(start: Date, end: Date) { return Math.max(1, Math.round((Number(this.dayStart(end)) - Number(this.dayStart(start))) / 86_400_000) + 1); }
  private dateKey(date: Date) { return this.dayStart(date).toISOString().slice(0, 10); }
  private dayStart(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); }
  private payrollPeriod(run: { year: number; month: number }) { return `${run.year}-${String(run.month).padStart(2, '0')}`; }

  private salaryAccessWhere(user: RequestUser): Prisma.SalaryRecordWhereInput {
    return { employee: this.compensationEmployeeWhere(user) };
  }

  private compensationEmployeeWhere(user: RequestUser): Prisma.EmployeeWhereInput {
    const scopes: Prisma.EmployeeWhereInput[] = [];
    const rule = this.authorization.scopeRule(user, 'payroll.read_compensation', AccessScopeType.ALL_EMPLOYEES);
    if (rule.unrestricted) {
      if (!rule.excludeIds.length) return {};
      scopes.push({ id: { notIn: rule.excludeIds } });
    }
    else if (rule.includeIds.length) scopes.push({ id: { in: rule.includeIds } });
    if (user.employeeId && this.authorization.permissionAllowedForScope(user, 'employee.self.read_compensation', AccessScopeType.SELF, user.employeeId)) scopes.push({ id: user.employeeId });
    return scopes.length ? { OR: scopes } : { id: '__salary_access_denied__' };
  }

  private payrollAccessWhere(user: RequestUser): Prisma.PayrollWhereInput {
    const scopes: Prisma.PayrollWhereInput[] = [];
    for (const permission of ['payroll.read', 'payroll.audit.read', 'payroll.payslip.read_all'] as const) {
      const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_EMPLOYEES);
      if (rule.unrestricted) {
        if (!rule.excludeIds.length) return {};
        scopes.push({ employeeId: { notIn: rule.excludeIds } });
      }
      else if (rule.includeIds.length) scopes.push({ employeeId: { in: rule.includeIds } });
    }
    return scopes.length ? { OR: scopes } : { employeeId: '__payroll_access_denied__' };
  }

  private assertRunPermission(user: RequestUser, permissions: string[], runId: string) {
    if (!permissions.some((permission) => this.authorization.permissionAllowedForScope(user, permission, AccessScopeType.ALL_SYSTEM, runId))) throw new NotFoundException('Payroll run not found');
  }

  private runAccessWhere(user: RequestUser, permissions: string[]): Prisma.PayrollRunWhereInput {
    const scopes: Prisma.PayrollRunWhereInput[] = [];
    for (const permission of permissions) {
      const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_SYSTEM);
      if (rule.unrestricted) {
        if (!rule.excludeIds.length) return {};
        scopes.push({ id: { notIn: rule.excludeIds } });
      }
      else if (rule.includeIds.length) scopes.push({ id: { in: rule.includeIds } });
    }
    return scopes.length ? { OR: scopes } : { id: '__payroll_run_access_denied__' };
  }

  private async ensureEmployee(employeeId: string) { const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } }); if (!employee) throw new NotFoundException('Employee not found'); return employee; }
  private async ensureRun(id: string, client: Prisma.TransactionClient | PrismaService = this.prisma) { const run = await client.payrollRun.findUnique({ where: { id } }); if (!run) throw new NotFoundException('Payroll run not found'); return run; }
  private async ensureSalaryRecord(id: string, client: Prisma.TransactionClient | PrismaService = this.prisma) { const record = await client.salaryRecord.findFirst({ where: { id, deletedAt: null } }); if (!record) throw new NotFoundException('Salary record not found'); return record; }
  private assertDateRange(start: Date, end: Date | undefined, field: string) { if (end && end < start) throw new BadRequestException(`${field} must be on or after the start date`); }
  private async assertSalaryPeriodAvailable(employeeId: string, effectiveFrom: Date, effectiveTo: Date | undefined, excludeId: string | undefined, tx: Prisma.TransactionClient) {
    const overlap = await tx.salaryRecord.findFirst({ where: { employeeId, id: excludeId ? { not: excludeId } : undefined, deletedAt: null, effectiveFrom: effectiveTo ? { lte: effectiveTo } : undefined, OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] }, select: { id: true } });
    if (overlap) throw new ConflictException('Salary record dates overlap an existing record');
  }

  private async idempotentRun(tx: Prisma.TransactionClient, user: RequestUser, operation: string, key: string | undefined, payload: unknown) {
    this.validateIdempotencyKey(key); const hash = this.requestHash(payload);
    const existing = await tx.idempotencyRecord.findUnique({ where: { actorUserId_operation_key: { actorUserId: user.id, operation, key: key! } } });
    if (!existing) return null; if (existing.requestHash !== hash) throw new ConflictException('Idempotency key was already used with a different request');
    return this.presentRun(await tx.payrollRun.findUniqueOrThrow({ where: { id: existing.resourceId }, include: payrollRunInclude }));
  }
  private saveIdempotency(tx: Prisma.TransactionClient, user: RequestUser, operation: string, key: string | undefined, payload: unknown, resourceType: string, resourceId: string) { return tx.idempotencyRecord.create({ data: { actorUserId: user.id, operation, key: key!, requestHash: this.requestHash(payload), resourceType, resourceId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } }); }
  private validateIdempotencyKey(key: string | undefined): asserts key is string { if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new BadRequestException('A valid Idempotency-Key header is required'); }
  private requestHash(payload: unknown) { return createHash('sha256').update(JSON.stringify(payload)).digest('hex'); }
  private assertVersion(actual: number, expected: number) { if (actual !== expected) throw new ConflictException('Payroll run changed; refresh and retry'); }

  private async payrollTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) { try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error; } }
    throw new ConflictException('Payroll changed in another request. Try again.');
  }
}

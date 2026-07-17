import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccessScopeType,
  AuditAction,
  LoanRepaymentMode,
  LoanRepaymentSource,
  LoanRepaymentStatus,
  LoanStatus,
  PayrollLineKind,
  Prisma,
} from '@prisma/client';
import { money, nonNegativeMoney, sumMoney, ZERO_MONEY } from '../../common/money';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLoanDto, LoanOverrideDto, LoanStatusTransitionDto, ManualRepaymentDto, QueryLoansDto, UpdateLoanDto } from './dto/loan.dto';
import { AuthorizationService } from '../authorization/authorization.service';

const includeLoan = {
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, departmentId: true } },
  overrides: { orderBy: [{ year: 'desc' as const }, { month: 'desc' as const }] },
  repayments: { where: { status: LoanRepaymentStatus.POSTED }, orderBy: { postedAt: 'desc' as const } },
};

@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(dto: CreateLoanDto, user: RequestUser) {
    await this.authorization.assertEmployeeScope(user, dto.employeeId, { all: 'loan.hr.manage' });
    const principal = nonNegativeMoney(dto.principal, 'principal');
    if (principal.isZero()) throw new BadRequestException('principal must be greater than zero');
    const monthlyLimit = nonNegativeMoney(dto.monthlyLimit ?? 0, 'monthlyLimit');
    if (dto.repaymentMode === LoanRepaymentMode.MONTHLY_LIMIT && monthlyLimit.isZero()) {
      throw new BadRequestException('monthlyLimit must be greater than zero for monthly-limit loans');
    }
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, deletedAt: null } });
    if (!employee) throw new NotFoundException('Employee not found');
    return this.transaction(async (tx) => {
      const loan = await tx.employeeLoan.create({
        data: { ...dto, principal, monthlyLimit, status: LoanStatus.DRAFT },
        include: includeLoan,
      });
      await this.audit.record(tx, user, {
        action: AuditAction.CREATE,
        entityType: 'EmployeeLoan',
        entityId: loan.id,
        summary: 'Loan created as draft',
        subjectEmployeeId: dto.employeeId,
      });
      return this.withBalance(loan);
    });
  }

  async list(query: QueryLoansDto, user: RequestUser) {
    const filters: Prisma.EmployeeLoanWhereInput[] = [this.accessWhere(user)];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.status) filters.push({ status: query.status });
    const { page, limit, ...args } = listArgs(query, {
      allowedSortFields: ['createdAt', 'principal', 'disbursementDate', 'status'],
      defaultSortBy: 'createdAt',
      where: { deletedAt: null, AND: filters },
      include: includeLoan,
    });
    const [data, total] = await Promise.all([
      this.prisma.employeeLoan.findMany(args),
      this.prisma.employeeLoan.count({ where: args.where }),
    ]);
    return { data: data.map((loan) => this.withBalance(loan)), meta: paginationMeta(total, page, limit) };
  }

  async update(id: string, dto: UpdateLoanDto, user: RequestUser) {
    return this.transaction(async (tx) => {
      const loan = await this.ensureLoan(id, tx);
      await this.authorization.assertEmployeeScope(user, loan.employeeId, { all: 'loan.hr.manage' });
      if (loan.status !== LoanStatus.DRAFT) throw new BadRequestException('Only draft loans can be edited');
      const principal = dto.principal === undefined ? undefined : nonNegativeMoney(dto.principal, 'principal');
      if (principal?.isZero()) throw new BadRequestException('principal must be greater than zero');
      const monthlyLimit = dto.monthlyLimit === undefined ? undefined : nonNegativeMoney(dto.monthlyLimit, 'monthlyLimit');
      const repaymentMode = dto.repaymentMode ?? loan.repaymentMode;
      const effectiveMonthlyLimit = monthlyLimit ?? loan.monthlyLimit;
      if (repaymentMode === LoanRepaymentMode.MONTHLY_LIMIT && effectiveMonthlyLimit.isZero()) {
        throw new BadRequestException('monthlyLimit must be greater than zero for monthly-limit loans');
      }
      const updated = await tx.employeeLoan.update({
        where: { id },
        data: { ...dto, principal, monthlyLimit, version: { increment: 1 } },
        include: includeLoan,
      });
      await this.audit.record(tx, user, {
        action: AuditAction.UPDATE,
        entityType: 'EmployeeLoan',
        entityId: id,
        summary: 'Draft loan updated',
        subjectEmployeeId: loan.employeeId,
        before: loan,
        after: updated,
      });
      return this.withBalance(updated);
    });
  }

  async find(id: string, user: RequestUser) {
    const loan = await this.prisma.employeeLoan.findFirst({ where: { AND: [{ id }, { deletedAt: null }, this.accessWhere(user)] }, include: includeLoan });
    if (!loan) throw new NotFoundException('Loan not found');
    return this.withBalance(loan);
  }

  async activate(id: string, user: RequestUser) {
    return this.transaction(async (tx) => {
      const loan = await this.ensureLoan(id, tx);
      await this.authorization.assertEmployeeScope(user, loan.employeeId, { all: 'loan.hr.manage' });
      if (loan.status !== LoanStatus.DRAFT && loan.status !== LoanStatus.PAUSED) {
        throw new BadRequestException('Only draft or paused loans can be activated');
      }
      const updated = await tx.employeeLoan.update({
        where: { id },
        data: { status: LoanStatus.ACTIVE, version: { increment: 1 } },
        include: includeLoan,
      });
      await this.audit.record(tx, user, {
        action: AuditAction.TRANSITION,
        entityType: 'EmployeeLoan',
        entityId: id,
        summary: 'Loan activated',
        changes: [{ field: 'status', previousValue: loan.status, nextValue: LoanStatus.ACTIVE }],
      });
      return this.withBalance(updated);
    });
  }

  async pause(id: string, dto: LoanStatusTransitionDto, user: RequestUser) {
    return this.transitionStatus(id, LoanStatus.ACTIVE, LoanStatus.PAUSED, dto.reason, user);
  }

  async cancel(id: string, dto: LoanStatusTransitionDto, user: RequestUser) {
    return this.transaction(async (tx) => {
      const loan = await this.ensureLoan(id, tx);
      await this.authorization.assertEmployeeScope(user, loan.employeeId, { all: 'loan.hr.manage' });
      if (loan.status !== LoanStatus.DRAFT && loan.status !== LoanStatus.ACTIVE && loan.status !== LoanStatus.PAUSED) {
        throw new BadRequestException('Only open loans can be cancelled');
      }
      const updated = await tx.employeeLoan.update({ where: { id }, data: { status: LoanStatus.CANCELLED, version: { increment: 1 } }, include: includeLoan });
      await this.audit.record(tx, user, {
        action: AuditAction.TRANSITION,
        entityType: 'EmployeeLoan',
        entityId: id,
        summary: 'Loan cancelled',
        reason: dto.reason,
        subjectEmployeeId: loan.employeeId,
        changes: [{ field: 'status', previousValue: loan.status, nextValue: LoanStatus.CANCELLED }],
      });
      return this.withBalance(updated);
    });
  }

  async setOverride(id: string, dto: LoanOverrideDto, user: RequestUser) {
    const amount = nonNegativeMoney(dto.amount, 'amount');
    return this.transaction(async (tx) => {
      const loan = await this.ensureLoan(id, tx);
      await this.authorization.assertEmployeeScope(user, loan.employeeId, { all: 'loan.hr.manage' });
      if (loan.status === LoanStatus.SETTLED || loan.status === LoanStatus.CANCELLED) {
        throw new BadRequestException('A closed loan cannot be overridden');
      }
      if (loan.monthlyLimit.gt(0) && amount.gt(loan.monthlyLimit) && !dto.approvedAboveLimit) {
        throw new BadRequestException('Override exceeds the monthly limit and requires explicit approval');
      }
      const override = await tx.loanDeductionOverride.upsert({
        where: { loanId_year_month: { loanId: id, year: dto.year, month: dto.month } },
        update: { amount, reason: dto.reason, approvedAboveLimit: dto.approvedAboveLimit ?? false },
        create: { loanId: id, year: dto.year, month: dto.month, amount, reason: dto.reason, approvedAboveLimit: dto.approvedAboveLimit ?? false },
      });
      await this.audit.record(tx, user, {
        action: AuditAction.UPDATE,
        entityType: 'LoanDeductionOverride',
        entityId: override.id,
        summary: 'Monthly loan deduction override saved',
      });
      return override;
    });
  }

  async manualRepayment(id: string, dto: ManualRepaymentDto, user: RequestUser) {
    const amount = nonNegativeMoney(dto.amount, 'amount');
    if (amount.isZero()) throw new BadRequestException('amount must be greater than zero');
    return this.transaction(async (tx) => {
      const loan = await this.ensureLoan(id, tx);
      await this.authorization.assertEmployeeScope(user, loan.employeeId, { all: 'loan.hr.manage' });
      if (loan.status !== LoanStatus.ACTIVE && loan.status !== LoanStatus.PAUSED) {
        throw new BadRequestException('Only active or paused loans can receive repayments');
      }
      const remaining = await this.remainingBalance(id, loan.principal, tx);
      if (amount.gt(remaining)) throw new BadRequestException('Repayment cannot exceed the remaining balance');
      const repayment = await tx.loanRepayment.create({
        data: { loanId: id, year: dto.year, month: dto.month, amount, source: LoanRepaymentSource.MANUAL, note: dto.note },
      });
      const nextRemaining = remaining.minus(amount);
      if (nextRemaining.isZero()) {
        await tx.employeeLoan.update({ where: { id }, data: { status: LoanStatus.SETTLED, version: { increment: 1 } } });
      }
      await this.audit.record(tx, user, {
        action: AuditAction.CREATE,
        entityType: 'LoanRepayment',
        entityId: repayment.id,
        summary: 'Manual loan repayment posted',
      });
      return { ...repayment, remainingBalance: nextRemaining.toFixed(2) };
    });
  }

  async preparePayrollDeductions(
    employeeId: string,
    year: number,
    month: number,
    availablePay: Prisma.Decimal,
    grossPay: Prisma.Decimal,
    companyCap: { type: string; value: Prisma.Decimal },
    tx: Prisma.TransactionClient,
  ) {
    const loans = await tx.employeeLoan.findMany({
      where: {
        employeeId,
        status: LoanStatus.ACTIVE,
        deletedAt: null,
        OR: [{ startYear: { lt: year } }, { startYear: year, startMonth: { lte: month } }],
      },
      include: { overrides: { where: { year, month } } },
      orderBy: [{ startYear: 'asc' }, { startMonth: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    const deductions: Array<{ loanId: string; amount: Prisma.Decimal; description: string }> = [];
    let payRemaining = Prisma.Decimal.max(ZERO_MONEY, availablePay);
    const configuredCap = companyCap.value.isZero()
      ? null
      : companyCap.type === 'PERCENT'
        ? money(grossPay.times(Prisma.Decimal.min(100, companyCap.value)).div(100), 'loan deduction cap')
        : companyCap.value;
    let capRemaining = configuredCap;
    for (const loan of loans) {
      if (payRemaining.isZero()) break;
      const remaining = await this.remainingBalance(loan.id, loan.principal, tx);
      if (remaining.isZero()) continue;
      const override = loan.overrides[0];
      let installment: Prisma.Decimal;
      if (override) {
        installment = override.amount;
      } else if (loan.repaymentMode === LoanRepaymentMode.DURATION) {
        installment = loan.principal.div(loan.termMonths).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      } else if (loan.repaymentMode === LoanRepaymentMode.MONTHLY_LIMIT) {
        installment = loan.monthlyLimit;
      } else {
        continue;
      }
      if (!override?.approvedAboveLimit) {
        if (loan.monthlyLimit.gt(0)) installment = Prisma.Decimal.min(installment, loan.monthlyLimit);
        if (capRemaining) installment = Prisma.Decimal.min(installment, capRemaining);
      }
      installment = nonNegativeMoney(Prisma.Decimal.min(installment, remaining, payRemaining), 'loan deduction');
      if (installment.isZero()) continue;
      deductions.push({ loanId: loan.id, amount: installment, description: `${loan.type} installment` });
      payRemaining = money(payRemaining.minus(installment));
      if (capRemaining) capRemaining = Prisma.Decimal.max(ZERO_MONEY, money(capRemaining.minus(installment)));
    }
    return { deductions, total: sumMoney(deductions.map((item) => item.amount)) };
  }

  async replacePayrollDeductionLines(
    payrollId: string,
    deductions: Array<{ loanId: string; amount: Prisma.Decimal; description: string }>,
    tx: Prisma.TransactionClient,
  ) {
    await tx.payrollLineItem.deleteMany({ where: { payrollId, kind: PayrollLineKind.LOAN_REPAYMENT } });
    for (const deduction of deductions) {
      await tx.payrollLineItem.create({
        data: { payrollId, loanId: deduction.loanId, kind: PayrollLineKind.LOAN_REPAYMENT, description: deduction.description, amount: deduction.amount },
      });
    }
  }

  async postPayrollDeductions(payrollId: string, year: number, month: number, tx: Prisma.TransactionClient) {
    const lines = await tx.payrollLineItem.findMany({ where: { payrollId, kind: PayrollLineKind.LOAN_REPAYMENT, loanId: { not: null } } });
    for (const line of lines) {
      await tx.loanRepayment.upsert({
        where: { payrollId_loanId: { payrollId, loanId: line.loanId! } },
        create: { payrollId, loanId: line.loanId!, year, month, amount: line.amount, source: LoanRepaymentSource.PAYROLL },
        update: { year, month, amount: line.amount, status: LoanRepaymentStatus.POSTED, reversedAt: null },
      });
    }
    await this.refreshLoanStatuses(lines.map((line) => line.loanId!), tx);
  }

  async refreshLoanStatuses(loanIds: string[], tx: Prisma.TransactionClient) {
    for (const id of new Set(loanIds)) {
      const loan = await tx.employeeLoan.findUnique({ where: { id } });
      if (!loan || loan.status === LoanStatus.CANCELLED || loan.status === LoanStatus.DRAFT) continue;
      const remaining = await this.remainingBalance(id, loan.principal, tx);
      const status = remaining.isZero() ? LoanStatus.SETTLED : loan.status === LoanStatus.SETTLED ? LoanStatus.ACTIVE : loan.status;
      if (status !== loan.status) await tx.employeeLoan.update({ where: { id }, data: { status, version: { increment: 1 } } });
    }
  }

  private async remainingBalance(id: string, principal: Prisma.Decimal, tx: Prisma.TransactionClient) {
    const repayments = await tx.loanRepayment.findMany({
      where: { loanId: id, status: LoanRepaymentStatus.POSTED },
      select: { amount: true },
    });
    return Prisma.Decimal.max(ZERO_MONEY, principal.minus(sumMoney(repayments.map((item) => item.amount))));
  }

  private withBalance<T extends { principal: Prisma.Decimal; repayments?: Array<{ amount: Prisma.Decimal }> }>(loan: T) {
    const paid = sumMoney((loan.repayments ?? []).map((item) => item.amount));
    return { ...loan, paidAmount: paid.toFixed(2), remainingBalance: Prisma.Decimal.max(ZERO_MONEY, loan.principal.minus(paid)).toFixed(2) };
  }

  private async ensureLoan(id: string, tx: Prisma.TransactionClient) {
    const loan = await tx.employeeLoan.findFirst({ where: { id, deletedAt: null } });
    if (!loan) throw new NotFoundException('Loan not found');
    return loan;
  }

  private transitionStatus(id: string, from: LoanStatus, to: LoanStatus, reason: string, user: RequestUser) {
    return this.transaction(async (tx) => {
      const loan = await this.ensureLoan(id, tx);
      await this.authorization.assertEmployeeScope(user, loan.employeeId, { all: 'loan.hr.manage' });
      if (loan.status !== from) throw new BadRequestException(`Loan must be ${from.toLowerCase()}`);
      const updated = await tx.employeeLoan.update({ where: { id }, data: { status: to, version: { increment: 1 } }, include: includeLoan });
      await this.audit.record(tx, user, {
        action: AuditAction.TRANSITION,
        entityType: 'EmployeeLoan',
        entityId: id,
        summary: `Loan moved to ${to.toLowerCase()}`,
        reason,
        subjectEmployeeId: loan.employeeId,
        changes: [{ field: 'status', previousValue: from, nextValue: to }],
      });
      return this.withBalance(updated);
    });
  }

  private accessWhere(user: RequestUser): Prisma.EmployeeLoanWhereInput {
    const scopes: Prisma.EmployeeLoanWhereInput[] = [];
    for (const permission of ['loan.hr.read', 'loan.audit.read', 'loan.read_all'] as const) {
      const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_EMPLOYEES);
      if (rule.unrestricted) {
        if (!rule.excludeIds.length) return {};
        scopes.push({ employeeId: { notIn: rule.excludeIds } });
      }
      else if (rule.includeIds.length) scopes.push({ employeeId: { in: rule.includeIds } });
    }
    if (user.employeeId && this.authorization.permissionAllowedForScope(user, 'loan.self.read', AccessScopeType.SELF, user.employeeId)) scopes.push({ employeeId: user.employeeId });
    return scopes.length ? { OR: scopes } : { employeeId: '__no_loan_scope__' };
  }

  private async transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      }
    }
    throw new ConflictException('Loan changed in another request. Try again.');
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  LoanRepaymentMode,
  LoanRepaymentSource,
  LoanRepaymentStatus,
  LoanStatus,
  PayrollLineKind,
  Prisma,
} from '@prisma/client';
import { nonNegativeMoney, sumMoney, ZERO_MONEY } from '../../common/money';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLoanDto, LoanOverrideDto, ManualRepaymentDto, QueryLoansDto } from './dto/loan.dto';

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
  ) {}

  async create(dto: CreateLoanDto, user: RequestUser) {
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
      });
      return this.withBalance(loan);
    });
  }

  async list(query: QueryLoansDto) {
    const filters: Record<string, unknown>[] = [];
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

  async find(id: string) {
    const loan = await this.prisma.employeeLoan.findFirst({ where: { id, deletedAt: null }, include: includeLoan });
    if (!loan) throw new NotFoundException('Loan not found');
    return this.withBalance(loan);
  }

  async activate(id: string, user: RequestUser) {
    return this.transaction(async (tx) => {
      const loan = await this.ensureLoan(id, tx);
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

  async setOverride(id: string, dto: LoanOverrideDto, user: RequestUser) {
    const amount = nonNegativeMoney(dto.amount, 'amount');
    return this.transaction(async (tx) => {
      const loan = await this.ensureLoan(id, tx);
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
    tx: Prisma.TransactionClient,
  ) {
    const period = year * 12 + month;
    const loans = await tx.employeeLoan.findMany({
      where: {
        employeeId,
        status: LoanStatus.ACTIVE,
        deletedAt: null,
        OR: [{ startYear: { lt: year } }, { startYear: year, startMonth: { lte: month } }],
      },
      include: { overrides: { where: { year, month } } },
      orderBy: { createdAt: 'asc' },
    });
    const deductions: Array<{ loanId: string; amount: Prisma.Decimal; description: string }> = [];
    for (const loan of loans) {
      const remaining = await this.remainingBalance(loan.id, loan.principal, tx);
      if (remaining.isZero()) continue;
      const override = loan.overrides[0];
      let installment: Prisma.Decimal;
      if (override) {
        installment = override.amount;
      } else if (loan.repaymentMode === LoanRepaymentMode.DURATION) {
        const elapsed = period - (loan.startYear * 12 + loan.startMonth);
        if (elapsed >= loan.termMonths) continue;
        installment = loan.principal.div(loan.termMonths).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      } else if (loan.repaymentMode === LoanRepaymentMode.MONTHLY_LIMIT) {
        installment = loan.monthlyLimit;
      } else {
        continue;
      }
      if (!override?.approvedAboveLimit && loan.monthlyLimit.gt(0)) {
        installment = Prisma.Decimal.min(installment, loan.monthlyLimit);
      }
      installment = nonNegativeMoney(Prisma.Decimal.min(installment, remaining), 'loan deduction');
      if (installment.isZero()) continue;
      deductions.push({ loanId: loan.id, amount: installment, description: `${loan.type} installment` });
    }
    return { deductions, total: sumMoney(deductions.map((item) => item.amount)) };
  }

  async postPayrollDeductions(
    payrollId: string,
    year: number,
    month: number,
    deductions: Array<{ loanId: string; amount: Prisma.Decimal; description: string }>,
    tx: Prisma.TransactionClient,
  ) {
    await tx.loanRepayment.deleteMany({ where: { payrollId } });
    await tx.payrollLineItem.deleteMany({ where: { payrollId, kind: PayrollLineKind.LOAN_REPAYMENT } });
    for (const deduction of deductions) {
      await tx.payrollLineItem.create({
        data: { payrollId, loanId: deduction.loanId, kind: PayrollLineKind.LOAN_REPAYMENT, description: deduction.description, amount: deduction.amount },
      });
      await tx.loanRepayment.create({
        data: { payrollId, loanId: deduction.loanId, year, month, amount: deduction.amount, source: LoanRepaymentSource.PAYROLL },
      });
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

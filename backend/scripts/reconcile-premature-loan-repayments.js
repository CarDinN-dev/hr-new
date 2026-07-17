/* eslint-disable no-console */
const {
  AuditAction,
  LoanRepaymentSource,
  LoanRepaymentStatus,
  LoanStatus,
  PayrollLineKind,
  PayrollRunStatus,
  Prisma,
  PrismaClient,
} = require('@prisma/client');
const { ConfigService } = require('@nestjs/config');
const { AuditService } = require('../dist/modules/audit/audit.service');

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

function validateRepayment(repayment) {
  const issues = [];
  if (!repayment.payrollId || !repayment.payroll) issues.push('orphaned payroll link');
  if (!repayment.loan) issues.push('orphaned loan link');
  if (!repayment.payroll || !repayment.loan) return issues;
  if (repayment.payroll.employeeId !== repayment.loan.employeeId) issues.push('payroll employee differs from loan employee');
  if (repayment.year !== repayment.payroll.year || repayment.month !== repayment.payroll.month) issues.push('repayment period differs from payroll period');
  const matchingLines = repayment.payroll.lineItems.filter((line) => line.loanId === repayment.loanId);
  if (matchingLines.length !== 1) issues.push(`expected one matching loan line, found ${matchingLines.length}`);
  else if (!matchingLines[0].amount.equals(repayment.amount)) issues.push('repayment amount differs from payroll loan line');
  return issues;
}

async function candidates(client = prisma) {
  return client.loanRepayment.findMany({
    where: { source: LoanRepaymentSource.PAYROLL, status: LoanRepaymentStatus.POSTED },
    orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
    include: {
      loan: { select: { id: true, employeeId: true, principal: true, status: true } },
      payroll: {
        select: {
          id: true,
          employeeId: true,
          year: true,
          month: true,
          payrollRun: { select: { id: true, status: true } },
          lineItems: {
            where: { kind: PayrollLineKind.LOAN_REPAYMENT },
            select: { id: true, loanId: true, amount: true },
          },
        },
      },
    },
  });
}

async function remainingBalance(tx, loanId, principal) {
  const posted = await tx.loanRepayment.findMany({
    where: { loanId, status: LoanRepaymentStatus.POSTED },
    select: { amount: true },
  });
  const total = posted.reduce((sum, repayment) => sum.plus(repayment.amount), new Prisma.Decimal(0));
  return Prisma.Decimal.max(0, principal.minus(total));
}

async function main() {
  const repayments = await candidates();
  const invalid = repayments
    .map((repayment) => ({ id: repayment.id, issues: validateRepayment(repayment) }))
    .filter((row) => row.issues.length);
  if (invalid.length) {
    console.error(JSON.stringify({ applied: false, aborted: true, reason: 'Orphaned or ambiguous payroll repayments found', invalid }, null, 2));
    process.exitCode = 2;
    return;
  }

  const affected = repayments.filter((repayment) => repayment.payroll.payrollRun.status !== PayrollRunStatus.PAID);
  const report = {
    applied: apply,
    aborted: false,
    inspectedPostedPayrollRepayments: repayments.length,
    affectedRepayments: affected.map((repayment) => ({
      repaymentId: repayment.id,
      loanId: repayment.loanId,
      payrollId: repayment.payrollId,
      payrollRunId: repayment.payroll.payrollRun.id,
      payrollRunStatus: repayment.payroll.payrollRun.status,
      period: `${repayment.year}-${String(repayment.month).padStart(2, '0')}`,
      amount: repayment.amount.toFixed(2),
    })),
    affectedLoanIds: [...new Set(affected.map((repayment) => repayment.loanId))],
  };
  if (!apply || !affected.length) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (process.env.LOAN_RECONCILIATION_CONFIRM !== 'REVERSE_NON_PAID_PAYROLL_REPAYMENTS') {
    throw new Error('LOAN_RECONCILIATION_CONFIRM=REVERSE_NON_PAID_PAYROLL_REPAYMENTS is required with --apply');
  }

  const config = new ConfigService();
  const audit = new AuditService(prisma, config, undefined, undefined);
  await prisma.$transaction(async (tx) => {
    const current = await candidates(tx);
    const currentById = new Map(current.map((repayment) => [repayment.id, repayment]));
    for (const expected of affected) {
      const repayment = currentById.get(expected.id);
      if (!repayment || validateRepayment(repayment).length || repayment.payroll.payrollRun.status === PayrollRunStatus.PAID) {
        throw new Error(`Repayment ${expected.id} changed after the dry-run read; reconciliation aborted`);
      }
      await tx.loanRepayment.update({
        where: { id: repayment.id },
        data: { status: LoanRepaymentStatus.REVERSED, reversedAt: new Date() },
      });
      await audit.record(tx, null, {
        action: AuditAction.UPDATE,
        entityType: 'LoanRepayment',
        entityId: repayment.id,
        subjectEmployeeId: repayment.loan.employeeId,
        payrollPeriod: `${repayment.year}-${String(repayment.month).padStart(2, '0')}`,
        summary: 'Premature payroll loan repayment reversed by verified reconciliation',
        before: { status: LoanRepaymentStatus.POSTED, payrollRunStatus: repayment.payroll.payrollRun.status },
        after: { status: LoanRepaymentStatus.REVERSED },
      });
    }
    for (const loanId of report.affectedLoanIds) {
      const loan = await tx.employeeLoan.findUniqueOrThrow({ where: { id: loanId } });
      if (loan.status === LoanStatus.CANCELLED || loan.status === LoanStatus.DRAFT) continue;
      const remaining = await remainingBalance(tx, loan.id, loan.principal);
      const status = remaining.isZero() ? LoanStatus.SETTLED : loan.status === LoanStatus.SETTLED ? LoanStatus.ACTIVE : loan.status;
      if (status !== loan.status) {
        await tx.employeeLoan.update({ where: { id: loan.id }, data: { status, version: { increment: 1 } } });
        await audit.record(tx, null, {
          action: AuditAction.TRANSITION,
          entityType: 'EmployeeLoan',
          entityId: loan.id,
          subjectEmployeeId: loan.employeeId,
          summary: 'Loan status refreshed after repayment reconciliation',
          changes: [{ field: 'status', previousValue: loan.status, nextValue: status }],
        });
      }
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

/* eslint-disable no-console */
const assert = require('node:assert/strict');
const { AttendanceStatus, LoanRepaymentMode, LoanStatus, Prisma } = require('@prisma/client');
const { money, percentageMoney, sumMoney } = require('../dist/common/money');
const { LoansService } = require('../dist/modules/loans/loans.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');

async function main() {
  assert.equal(money('0.005').toFixed(2), '0.01');
  assert.equal(sumMoney(['0.10', '0.20']).toFixed(2), '0.30');
  assert.equal(percentageMoney('3250.00', '7.50').toFixed(2), '243.75');

  const loan = {
    id: 'loan-1', employeeId: 'employee-1', type: 'Advance', principal: new Prisma.Decimal('12000.00'),
    startYear: 2026, startMonth: 1, repaymentMode: LoanRepaymentMode.DURATION, termMonths: 7,
    monthlyLimit: new Prisma.Decimal(0), status: LoanStatus.ACTIVE, deletedAt: null, overrides: [], createdAt: new Date(),
  };
  const posted = [];
  const tx = {
    employeeLoan: { findMany: async () => [loan] },
    loanRepayment: { findMany: async () => posted.map((amount) => ({ amount: new Prisma.Decimal(amount) })) },
  };
  const loans = new LoansService({}, {}, {});
  const first = await loans.preparePayrollDeductions('employee-1', 2026, 1, tx);
  assert.equal(first.total.toFixed(2), '1714.29');
  posted.push('1714.29', '1714.29', '1714.29', '1714.29', '1714.29', '1714.29');
  const final = await loans.preparePayrollDeductions('employee-1', 2026, 7, tx);
  assert.equal(final.total.toFixed(2), '1714.26');

  const payroll = new PayrollService({}, loans, {}, {}, {});
  const grossPay = sumMoney(['3000', '200', '50']);
  const netPay = grossPay.minus(sumMoney(['100', '25']));
  assert.equal(grossPay.toFixed(2), '3250.00');
  assert.equal(netPay.toFixed(2), '3125.00');
  const lopDays = await payroll.payrollLopDays('employee-1', new Date('2026-07-01T00:00:00Z'), new Date('2026-07-31T23:59:59Z'), {
    attendance: { findMany: async () => [
      { attendanceDate: new Date('2026-07-02T00:00:00Z'), status: AttendanceStatus.ABSENT },
      { attendanceDate: new Date('2026-07-03T00:00:00Z'), status: AttendanceStatus.HALF_DAY },
    ] },
    leaveRequest: { findMany: async () => [] },
  });
  assert.equal(lopDays.toFixed(2), '1.50');
  assert.equal(money(new Prisma.Decimal('111600').div(30).times(lopDays)).toFixed(2), '5580.00');
  console.log('Financial regression checks passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

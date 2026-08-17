/* eslint-disable no-console */
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
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
  const payslipLines = Array.from({ length: 48 }, (_, index) => ({
    description: `${index % 3 === 0 ? 'Deduction adjustment' : 'Earning component'} ${index + 1} with a professional multi-line description`,
    kind: index % 3 === 0 ? 'FIXED_DEDUCTION' : 'ALLOWANCE',
    amount: new Prisma.Decimal(index % 3 === 0 ? '10.00' : '75.00'),
  }));
  const brandedPayslip = payroll.payslipPdf({
    employee: {
      firstName: 'Payroll', lastName: 'Employee', employeeCode: 'MT-0001', email: 'payroll.employee@example.invalid',
      hireDate: new Date('2020-01-15T00:00:00.000Z'), employmentStatus: 'ACTIVE', department: { name: 'Human Resources' }, position: { title: 'Payroll Specialist' },
    },
    lineItems: payslipLines,
    grossPay, deductions: new Prisma.Decimal('100.00'), taxAmount: new Prisma.Decimal('25.00'), netPay,
  }, { year: 2026, month: 8, revision: 1 }, {
    name: 'MedTech', legalName: 'MedTech Corporation Trading W.L.L.', address: 'Doha, Qatar', phone: '+974 4443 4140',
    email: 'hr@med-tech.com', website: 'https://med-tech.com', currency: 'QAR',
  });
  assert.equal(brandedPayslip.subarray(0, 4).toString(), '%PDF');
  const payslipSource = brandedPayslip.toString('latin1');
  assert.match(payslipSource, /\/Subtype \/Image/);
  assert.match(payslipSource, /MedTech Corporation Trading/);
  assert.ok((payslipSource.match(/\/Type \/Page\b/g) || []).length >= 2);
  if (process.env.PAYSLIP_RENDER_PATH) writeFileSync(process.env.PAYSLIP_RENDER_PATH, brandedPayslip);
  const lopDays = await payroll.payrollLopDays('employee-1', new Date('2026-07-01T00:00:00Z'), new Date('2026-07-31T23:59:59Z'), {
    attendance: { findMany: async () => [
      { attendanceDate: new Date('2026-07-02T00:00:00Z'), status: AttendanceStatus.ABSENT },
      { attendanceDate: new Date('2026-07-03T00:00:00Z'), status: AttendanceStatus.HALF_DAY },
    ] },
    leaveRequest: { findMany: async () => [] },
  });
  assert.equal(lopDays.toFixed(2), '1.50');
  assert.equal(money(new Prisma.Decimal('111600').div(30).times(lopDays)).toFixed(2), '5580.00');

  const compassionateLop = await payroll.payrollLopDayValues('employee-1', new Date('2026-08-01T00:00:00Z'), new Date('2026-08-31T23:59:59Z'), {
    attendance: { findMany: async () => [] },
    leaveRequest: { findMany: async () => [{
      startDate: new Date('2026-08-06T00:00:00Z'), endDate: new Date('2026-08-12T00:00:00Z'),
      totalDays: new Prisma.Decimal(5), paidDays: new Prisma.Decimal(3), leaveType: { code: 'COMPASSIONATE', name: 'Compassionate Leave' },
    }] },
  });
  assert.deepEqual([...compassionateLop.keys()], ['2026-08-11', '2026-08-12']);
  assert.equal([...compassionateLop.values()].reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)).toFixed(2), '2.00');

  const componentEmployee = {
    id: 'employee-2', employeeCode: 'MTC082', firstName: 'Component', lastName: 'Test', hireDate: new Date('2026-07-01T00:00:00Z'), salary: new Prisma.Decimal('5000.00'),
    bankAccount: { bankCode: 'BANK', iban: 'QA000000000000000000000001', accountNumber: null }, profile: null, credentials: [{ type: 'QID', number: '12345678901' }],
    salaryRecords: [{ id: 'salary-1', version: 1, effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: null, baseSalary: new Prisma.Decimal('5000.00'), hra: new Prisma.Decimal('1000.00'), conveyance: new Prisma.Decimal(0), mobile: new Prisma.Decimal(0), food: new Prisma.Decimal(0), fuel: new Prisma.Decimal('200.00'), other: new Prisma.Decimal(0), grossAdjustment: new Prisma.Decimal(0), allowances: new Prisma.Decimal('1200.00'), deductions: new Prisma.Decimal(0), bonuses: new Prisma.Decimal(0), taxRate: new Prisma.Decimal(0) }],
  };
  const preflightClient = {
    organizationSettings: { findUnique: async () => ({ payrollProrationBasis: 'FIXED_30', payrollRequireBankDetails: true, payrollRequireAttendance: false, payrollVarianceThreshold: new Prisma.Decimal(25), financialPolicyVersion: 3 }) },
    employee: { findMany: async () => [componentEmployee] },
    payrollAdjustment: { findMany: async () => [] },
    attendance: { findMany: async () => [], count: async () => 1 },
    leaveRequest: { findMany: async () => [] },
    payroll: { findFirst: async () => null },
    employeeLoan: { findMany: async () => [] },
    loanRepayment: { findMany: async () => [] },
  };
  const componentPayroll = new PayrollService({}, new LoansService({}, {}, {}), {}, {}, {});
  const componentPreflight = await componentPayroll.collectPayrollInputs({ year: 2026, month: 7 }, preflightClient);
  assert.equal(componentPreflight.issues.filter((issue) => issue.severity === 'ERROR').length, 0);
  assert.equal(componentPreflight.calculations[0].allowances.toFixed(2), '1200.00');
  assert.equal(componentPreflight.calculations[0].grossPay.toFixed(2), '6200.00');
  assert.ok(componentPreflight.calculations[0].lines.some((line) => line.description === 'Housing allowance' && line.amount.toFixed(2) === '1000.00'));
  assert.ok(!componentPreflight.calculations[0].lines.some((line) => line.description === 'Allowances'));
  assert.match(componentPreflight.calculations[0].calculationHash, /^[a-f0-9]{64}$/);

  const joiner = { ...componentEmployee, id: 'employee-3', employeeCode: 'MTC083', hireDate: new Date('2026-07-16T00:00:00Z'), salaryRecords: [{ ...componentEmployee.salaryRecords[0], baseSalary: new Prisma.Decimal('3100.00'), hra: new Prisma.Decimal(0), fuel: new Prisma.Decimal(0), allowances: new Prisma.Decimal(0) }] };
  preflightClient.organizationSettings.findUnique = async () => ({ payrollProrationBasis: 'CALENDAR_DAYS', payrollRequireBankDetails: true, payrollRequireAttendance: false, payrollVarianceThreshold: new Prisma.Decimal(25), financialPolicyVersion: 4 });
  preflightClient.employee.findMany = async () => [joiner];
  const joinerPreflight = await componentPayroll.collectPayrollInputs({ year: 2026, month: 7 }, preflightClient);
  assert.equal(joinerPreflight.calculations[0].baseSalary.toFixed(2), '1600.00');
  assert.equal(joinerPreflight.calculations[0].grossPay.toFixed(2), '1600.00');
  assert.throws(() => componentPayroll.assertRunShape({ year: 2026, month: 7, runType: 'OFF_CYCLE' }, 'OFF_CYCLE'), /Off-cycle payroll requires/);
  console.log('Financial regression checks passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

import { describe, expect, it } from "vitest";
import { attendanceDaySummary, candidatePipeline, clearAttendanceDay, createEosRecord, createPayroll, decideAttendance, decideLeave, deleteEmployee, deleteLeave, employeeSalary, eosSummary, expenseTotals, finalizePayrollSlip, hireCandidateAsEmployee, inclusiveDays, leaveBalanceSummary, loanBalance, markAllAttendance, recordManualLoanRepayment, serviceYears, setAttendance, setLoanDeductionOverride, settlementSummary, todayISO, tripTotal, upcomingBirthdays } from "./domain";
import { type EmployeeLoan } from "./data";
import { testState } from "./testState";

describe("HR domain", () => {
  it("keeps leave balances, LOP payroll and settlement in sync", () => {
    let state = testState();
    const employee = state.employees[0];
    employee.fields["Annual Leave Balance"] = "30";
    employee.fields["LOP Days (Loss of Pay)"] = "0";
    state = {
      ...state,
      leaves: [{
        id: "LV-1",
        employeeId: employee.id,
        type: "Annual leave",
        from: "2026-07-01",
        to: "2026-07-02",
        days: inclusiveDays("2026-07-01", "2026-07-02"),
        reason: "Family",
        status: "Pending",
        appliedOn: "2026-06-30"
      }]
    };

    state = decideLeave(state, "LV-1", "Approved");
    const updatedEmployee = state.employees.find(item => item.id === employee.id)!;
    expect(updatedEmployee.fields["Annual Leave Balance"]).toBe("28");
    expect(leaveBalanceSummary(state, employee.id, "Annual leave", 2026).remaining).toBe(28);

    state = {
      ...state,
      leaves: [...state.leaves, {
        id: "LV-2",
        employeeId: employee.id,
        type: "Unpaid leave",
        from: "2026-07-04",
        to: "2026-07-05",
        days: 2,
        reason: "Personal",
        status: "Pending",
        appliedOn: "2026-06-30"
      }]
    };
    state = decideLeave(state, "LV-2", "Approved");
    state = markAllAttendance(state, "2026-07-03", "A");
    const result = createPayroll(state, 2026, 7);
    const slip = result.state.payroll.find(item => item.employeeId === employee.id);
    const settlement = settlementSummary(result.state.employees.find(item => item.id === employee.id)!, result.state, "2026-07-31");

    expect(state.attendance["2026-07-01"][employee.id]).toBe("L");
    expect(slip?.lopDays).toBe(3);
    expect(settlement.gratuity).toBeGreaterThan(0);
    expect(settlement.lopDeduction).toBeGreaterThan(0);
    expect(result.created).toBeGreaterThan(0);

    state = deleteLeave(state, "LV-1");
    expect(state.attendance["2026-07-01"][employee.id]).toBeUndefined();
    expect(state.employees.find(item => item.id === employee.id)?.fields["Annual Leave Balance"]).toBe("30");
  });

  it("updates draft payroll when attendance changes after payroll is generated", () => {
    let state = testState();
    const employee = state.employees[0];
    state = createPayroll(state, 2026, 7).state;
    const cleanSlip = state.payroll.find(item => item.employeeId === employee.id && item.year === 2026 && item.month === 7)!;

    state = markAllAttendance(state, "2026-07-09", "A");
    const rerun = createPayroll(state, 2026, 7);
    const updatedSlip = rerun.state.payroll.find(item => item.id === cleanSlip.id)!;

    expect(rerun.updated).toBeGreaterThan(0);
    expect(updatedSlip.lopDays).toBe(1);
    expect(updatedSlip.net).toBeLessThan(cleanSlip.net);
  });

  it("deducts half a day of pay for a half-day attendance mark", () => {
    let state = testState();
    const employee = state.employees[0];
    const clean = createPayroll(state, 2026, 7).state.payroll.find(item => item.employeeId === employee.id)!;

    state = setAttendance(state, "2026-07-13", employee.id, "H");
    const slip = createPayroll(state, 2026, 7).state.payroll.find(item => item.employeeId === employee.id)!;

    expect(slip.lopDays).toBe(0.5);
    expect(slip.lopAmount).toBeCloseTo(clean.lopAmount + employeeSalary(employee).total / 60, 2);
    expect(slip.net).toBeLessThan(clean.net);
  });

  it("preserves half-day unpaid leave in balances and payroll", () => {
    const state = testState();
    const employee = state.employees[0];
    const withHalfDayLeave = {
      ...state,
      leaves: [{
        id: "LV-HALF",
        employeeId: employee.id,
        type: "Unpaid leave",
        from: "2026-07-14",
        to: "2026-07-14",
        days: 0.5,
        reason: "Appointment",
        status: "Approved" as const,
        appliedOn: "2026-07-10"
      }]
    };

    const balance = leaveBalanceSummary(withHalfDayLeave, employee.id, "Unpaid leave", 2026);
    const slip = createPayroll(withHalfDayLeave, 2026, 7).state.payroll.find(item => item.employeeId === employee.id)!;

    expect(balance.used).toBe(0.5);
    expect(slip.lopDays).toBe(0.5);
    expect(slip.lopAmount).toBeCloseTo(employeeSalary(employee).total / 60, 2);
  });

  it("caps automatic loan deductions and posts each payroll repayment once", () => {
    let state = testState();
    const employee = state.employees[0];
    const loan = testLoan(employee.id, { principal: 1_200, termMonths: 2 });
    state = { ...state, loans: [loan], settings: { ...state.settings, loanDeductionCap: { type: "Amount", value: 500 } } };

    const generated = createPayroll(state, 2026, 7).state;
    const slip = generated.payroll.find(item => item.employeeId === employee.id)!;
    expect(slip.loanDeduction).toBe(500);
    expect(slip.net).toBe(slip.gross - slip.lopAmount - 500);
    expect(loanBalance(generated, loan.id)).toBe(1_200);

    const withStaleAugust = createPayroll(generated, 2026, 8).state;
    const finalized = finalizePayrollSlip(withStaleAugust, slip.id);
    expect(loanBalance(finalized, loan.id)).toBe(700);
    expect(finalized.loanRepayments).toHaveLength(1);
    expect(finalizePayrollSlip(finalized, slip.id).loanRepayments).toHaveLength(1);

    const settledBeforeAugust = recordManualLoanRepayment(finalized, loan.id, 700, "Early settlement", "2026-07-31");
    const augustSlip = settledBeforeAugust.payroll.find(item => item.employeeId === employee.id && item.month === 8)!;
    const finalizedAugust = finalizePayrollSlip(settledBeforeAugust, augustSlip.id);
    expect(finalizedAugust.payroll.find(item => item.id === augustSlip.id)?.loanDeduction).toBe(0);
    expect(finalizedAugust.loanRepayments).toHaveLength(2);
  });

  it("supports manual payroll overrides and manual loan settlement", () => {
    let state = testState();
    const employee = state.employees[0];
    const loan = testLoan(employee.id, { repaymentMode: "Manual", termMonths: 0, monthlyLimit: 250, principal: 1_000 });
    state = { ...state, loans: [loan], settings: { ...state.settings, loanDeductionCap: { type: "Amount", value: 200 } } };
    expect(createPayroll(state, 2026, 7).state.payroll.find(item => item.employeeId === employee.id)?.loanDeduction).toBe(0);

    state = setLoanDeductionOverride(state, loan.id, "2026-07", 400, "Approved settlement increase", true);
    const generated = createPayroll(state, 2026, 7).state;
    const slip = generated.payroll.find(item => item.employeeId === employee.id)!;
    expect(slip.loanDeduction).toBe(400);

    state = finalizePayrollSlip(generated, slip.id);
    state = recordManualLoanRepayment(state, loan.id, 600, "Cash repayment", "2026-07-20");
    expect(loanBalance(state, loan.id)).toBe(0);
    expect(state.loans[0].status).toBe("Settled");
  });

  it("keeps overlapping leave attendance and splits cross-year leave balances", () => {
    let state = testState();
    const employee = state.employees[0];
    state = {
      ...state,
      leaves: [
        { id: "LV-A", employeeId: employee.id, type: "Annual leave", from: "2026-12-31", to: "2027-01-02", days: 3, reason: "Holiday", status: "Pending", appliedOn: "2026-12-01" },
        { id: "LV-B", employeeId: employee.id, type: "Annual leave", from: "2027-01-01", to: "2027-01-03", days: 3, reason: "Holiday", status: "Pending", appliedOn: "2026-12-01" }
      ]
    };

    state = decideLeave(decideLeave(state, "LV-A", "Approved"), "LV-B", "Approved");
    expect(leaveBalanceSummary(state, employee.id, "Annual leave", 2026).used).toBe(1);
    expect(leaveBalanceSummary(state, employee.id, "Annual leave", 2027).used).toBe(3);

    state = deleteLeave(state, "LV-A");
    expect(state.attendance["2027-01-01"][employee.id]).toBe("L");
    expect(state.attendance["2026-12-31"][employee.id]).toBeUndefined();
  });

  it("shows upcoming active employee birthdays and clears daily attendance", () => {
    let state = testState();
    const [todayBirthday, tomorrowBirthday, futureBirthday, inactiveBirthday] = state.employees;
    todayBirthday.fields["Date of Birth"] = "1990-07-09";
    tomorrowBirthday.fields["Date of Birth"] = "1991-07-10";
    futureBirthday.fields["Date of Birth"] = "1988-08-20";
    inactiveBirthday.fields["Date of Birth"] = "1989-07-11";
    inactiveBirthday.status = "Resigned";

    const birthdays = upcomingBirthdays(state.employees, 30, "2026-07-09");

    expect(birthdays.map(item => item.employee.id)).toEqual([todayBirthday.id, tomorrowBirthday.id]);
    expect(birthdays[0].daysUntil).toBe(0);
    expect(birthdays[1].daysUntil).toBe(1);

    state = markAllAttendance(state, "2026-07-09", "P");
    expect(state.attendance["2026-07-09"]).toBeDefined();
    state = clearAttendanceDay(state, "2026-07-09");
    expect(state.attendance["2026-07-09"]).toBeUndefined();
  });

  it("keeps a selected attendance status and cascades employee deletion", () => {
    const state = testState();
    const employee = state.employees[0];
    const absent = decideAttendance(setAttendance(state, "2026-07-12", employee.id, "A"), "2026-07-12", employee.id, "Approved");
    expect(absent.attendance["2026-07-12"][employee.id]).toBe("A");
    expect(absent.attendanceApprovals["2026-07-12"][employee.id]).toBe("Approved");

    const marked = decideAttendance(setAttendance(absent, "2026-07-12", employee.id, "H"), "2026-07-12", employee.id, "Approved");
    expect(marked.attendance["2026-07-12"][employee.id]).toBe("H");
    expect(marked.attendanceApprovals["2026-07-12"][employee.id]).toBe("Approved");

    const deleted = deleteEmployee({
      ...marked,
      documents: [{ id: "doc", employeeId: employee.id, template: "offer_letter", documentNumber: "DOC-1", generatedOn: "2026-07-12", status: "Generated" }]
    }, employee.id);
    expect(deleted.employees.some(item => item.id === employee.id)).toBe(false);
    expect(deleted.attendance["2026-07-12"]).toBeUndefined();
    expect(deleted.documents).toHaveLength(0);
  });

  it("uses local calendar dates and preserves leave during bulk attendance actions", () => {
    const state = testState();
    const [employee] = state.employees;
    const withLeave = setAttendance(state, "2026-07-12", employee.id, "L");
    expect(markAllAttendance(withLeave, "2026-07-12", "P").attendance["2026-07-12"][employee.id]).toBe("L");
    expect(clearAttendanceDay(withLeave, "2026-07-12").attendance["2026-07-12"][employee.id]).toBe("L");
    expect(todayISO(new Date(2026, 6, 12, 1))).toBe("2026-07-12");
    expect(serviceYears("2026-02-30", "2026-07-12")).toBe(0);
  });

  it("summarizes daily attendance for active employees only", () => {
    const state = testState();
    const employees = state.employees.slice(0, 3);
    employees[0].status = "Active";
    employees[1].status = "On Leave";
    employees[2].status = "Resigned";

    expect(attendanceDaySummary(employees, {
      [employees[0].id]: "P",
      [employees[1].id]: "H",
      [employees[2].id]: "A",
      staleEmployee: "P"
    })).toEqual({ total: 2, marked: 2, unmarked: 0, P: 1, H: 1, L: 0, A: 0 });

    expect(attendanceDaySummary(employees, { [employees[0].id]: "A" }))
      .toEqual({ total: 2, marked: 1, unmarked: 1, P: 0, H: 0, L: 0, A: 1 });
  });

  it("rolls business trip advances and approved expenses into EOS", () => {
    const state = testState();
    const employee = state.employees[0];
    employee.fields["Annual Leave Balance"] = "5";
    state.businessTrips = [{
      id: "BT-1",
      version: 1,
      employeeId: employee.id,
      destination: "Riyadh",
      purpose: "Client visit",
      from: "2026-07-01",
      to: "2026-07-03",
      days: 3,
      perDiem: 200,
      travelCost: 1000,
      advanceAmount: 500,
      status: "Approved",
      createdOn: "2026-06-20"
    }];
    state.expenses = [
      { id: "EX-1", version: 1, employeeId: employee.id, category: "Hotel", date: "2026-07-03", amount: 300, description: "Stay", status: "Approved", createdOn: "2026-07-04" },
      { id: "EX-2", version: 1, employeeId: employee.id, category: "Meal", date: "2026-07-03", amount: 75, description: "Dinner", status: "Paid", createdOn: "2026-07-04" }
    ];

    const summary = eosSummary(employee, state, "2026-07-31");
    const eos = createEosRecord(state, employee, "2026-07-31", "Resignation");

    expect(tripTotal(state.businessTrips[0])).toBe(1600);
    expect(expenseTotals(state.expenses)).toMatchObject({ approved: 300, paid: 75 });
    expect(summary.expenseReimbursement).toBe(300);
    expect(summary.tripAdvanceDeduction).toBe(500);
    expect(eos.netSettlement).toBe(summary.netSettlement);
    expect(eos.status).toBe("Draft");
  });

  it("moves hired recruitment candidates into employees once", () => {
    let state = testState();
    const candidate = state.candidates.find(item => item.stage === "Offer")!;
    state = {
      ...state,
      candidates: state.candidates.map(item => item.id === candidate.id ? { ...item, stage: "Hired" } : item)
    };

    const beforeCount = state.employees.length;
    const hired = hireCandidateAsEmployee(state, candidate.id);
    const addedEmployee = hired.employees.find(employee => employee.fields["Full Name"] === candidate.name);
    const pipeline = candidatePipeline(hired.candidates);
    const duplicateAttempt = hireCandidateAsEmployee(hired, candidate.id);

    expect(hired.employees).toHaveLength(beforeCount + 1);
    expect(addedEmployee?.fields.Designation).toBe(state.jobs.find(job => job.id === candidate.jobId)?.title);
    expect(addedEmployee?.fields.Department).toBe(state.jobs.find(job => job.id === candidate.jobId)?.dept);
    expect(hired.candidates.find(item => item.id === candidate.id)?.employeeId).toBe(addedEmployee?.id);
    expect(pipeline.Hired).toBeGreaterThan(0);
    expect(duplicateAttempt.employees).toHaveLength(beforeCount + 1);
  });
});

function testLoan(employeeId: string, patch: Partial<EmployeeLoan> = {}): EmployeeLoan {
  return {
    id: "LOAN-1",
    employeeId,
    type: "Salary advance",
    principal: 1_200,
    disbursementDate: "2026-06-20",
    startPeriod: "2026-07",
    repaymentMode: "Duration",
    termMonths: 12,
    monthlyLimit: 0,
    status: "Active",
    reference: "ADV-1",
    notes: "",
    createdOn: "2026-06-20",
    deductionOverrides: {},
    ...patch
  };
}

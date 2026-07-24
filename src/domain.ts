import type { AttendanceApproval, AttendanceCode, BusinessTrip, CandidateStage, EmployeeExpense, EmployeeLoan, EmployeeRecord, EosRecord, HrSettings, HrState, LeaveRequest, LeaveStatus, PayrollLoanDeduction, PayrollSlip, RecruitmentCandidate } from "./data";
import { candidateStages, createEmptyEmployee, months, normalizeEmployee } from "./data";
import { newId } from "./id";

export function todayISO(date = new Date()) {
  return dateToISO(date);
}

export function formatDate(value?: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${Number(day)} ${months[Number(month) - 1]?.slice(0, 3) ?? month} ${year}`;
}

export function formatMoney(value: number, currency = "QAR") {
  return `${currency} ${Number(value || 0).toLocaleString("en-QA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function moneyValue(value?: string) {
  const parsed = Number(String(value || "0").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function employeeName(employee?: EmployeeRecord) {
  return employee?.fields["Full Name"] || `${employee?.fields["First Name"] ?? ""} ${employee?.fields["Last Name"] ?? ""}`.trim() || "Unknown employee";
}

export function initials(employee: EmployeeRecord) {
  return employeeName(employee).split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

export function activeEmployees(employees: EmployeeRecord[]) {
  return employees.filter(employee => employee.status === "Active" || employee.status === "On Leave");
}

export function employeeSalary(employee: EmployeeRecord) {
  const fields = employee.fields;
  const basic = moneyValue(fields.Basic);
  const housing = moneyValue(fields.HRA);
  const allowances = moneyValue(fields["Conveyance Allowance"]) + moneyValue(fields["Food Allowance"]) + moneyValue(fields["Mobile Allowance"]) + moneyValue(fields["Fuel Allowance"]) + moneyValue(fields["Other Allowance"]) + moneyValue(fields["Gross Adjustment"]) + moneyValue(fields["Special Allowance"]) + moneyValue(fields["Transport Allowance"]);
  const overtime = moneyValue(fields["Overtime Amount"]);
  const total = moneyValue(fields.Total) || basic + housing + allowances + overtime;
  return { basic, housing, allowances, overtime, total };
}

export function nextEmployeeCode(employees: EmployeeRecord[]) {
  const max = employees.reduce((highest, employee) => {
    const match = /^MT-(\d+)$/.exec(employee.fields["Employee Code"] || "");
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `MT-${String(max + 1).padStart(4, "0")}`;
}

export function inclusiveDays(from: string, to: string) {
  const start = isoDate(from);
  const end = isoDate(to);
  return Math.round((Number(end) - Number(start)) / 86_400_000) + 1;
}

export function serviceYears(joiningDate?: string, asOf = todayISO()) {
  const joined = parseDateParts(joiningDate);
  const end = parseDateParts(asOf);
  if (!joined || !end) return 0;
  return Math.max(0, (Number(end) - Number(joined)) / 31_536_000_000);
}

export function upcomingBirthdays(employees: EmployeeRecord[], windowDays = 30, fromDate = todayISO()) {
  const today = parseDateParts(fromDate);
  if (!today) return [];
  today.setHours(0, 0, 0, 0);

  return activeEmployees(employees)
    .flatMap(employee => {
      const dob = parseDateParts(employee.fields["Date of Birth"]);
      if (!dob) return [];
      let next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
      if (next < today) next = new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate());
      const daysUntil = Math.round((Number(next) - Number(today)) / 86_400_000);
      if (daysUntil > windowDays) return [];
      return [{ employee, date: dateToISO(next), daysUntil }];
    })
    .sort((a, b) => a.daysUntil - b.daysUntil || employeeName(a.employee).localeCompare(employeeName(b.employee)));
}

export function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function attendanceStats(employees: EmployeeRecord[], attendance: HrState["attendance"], year: number, month: number) {
  const prefix = monthKey(year, month);
  return activeEmployees(employees).map(employee => {
    const stats: Record<AttendanceCode, number> & { employee: EmployeeRecord; pct: number; marked: number } = {
      employee,
      P: 0,
      H: 0,
      L: 0,
      A: 0,
      pct: 0,
      marked: 0
    };

    for (const [date, day] of Object.entries(attendance)) {
      if (!date.startsWith(prefix)) continue;
      const code = day[employee.id];
      if (code) stats[code] += 1;
    }

    stats.marked = stats.P + stats.H + stats.L + stats.A;
    stats.pct = stats.marked ? Math.round(((stats.P + stats.H * 0.5 + stats.L) / stats.marked) * 100) : 0;
    return stats;
  });
}

export function attendanceDaySummary(employees: EmployeeRecord[], day: Record<string, AttendanceCode> = {}) {
  const summary = { total: 0, marked: 0, unmarked: 0, P: 0, H: 0, L: 0, A: 0 };
  for (const employee of activeEmployees(employees)) {
    summary.total += 1;
    const code = day[employee.id];
    if (code) {
      summary[code] += 1;
      summary.marked += 1;
    } else {
      summary.unmarked += 1;
    }
  }
  return summary;
}

export function leaveBalanceSummary(state: HrState, employeeId: string, typeName: string, year = new Date().getFullYear()) {
  const type = state.settings.leaveTypes.find(item => item.name === typeName);
  const total = type?.days ?? 0;
  const requests = state.leaves.filter(item => item.employeeId === employeeId && item.type === typeName);
  const usedDays = leaveDayWeights(requests.filter(item => item.status === "Approved"), String(year));
  const pendingDays = leaveDayWeights(requests.filter(item => item.status === "Pending"), String(year));
  const used = roundMoney([...usedDays.values()].reduce((sum, value) => sum + value, 0));
  const pending = roundMoney([...pendingDays].reduce((sum, [key, value]) => sum + Math.max(0, value - (usedDays.get(key) ?? 0)), 0));
  return { total, used, pending, remaining: total - used - pending };
}

export function setAttendance(state: HrState, date: string, employeeId: string, code: AttendanceCode) {
  const attendance = { ...state.attendance, [date]: { ...(state.attendance[date] || {}) } };
  attendance[date][employeeId] = code;
  const approvals = { ...state.attendanceApprovals, [date]: { ...(state.attendanceApprovals[date] || {}) } };
  delete approvals[date][employeeId];
  if (!Object.keys(approvals[date]).length) delete approvals[date];
  return { ...state, attendance, attendanceApprovals: approvals };
}

export function decideAttendance(state: HrState, date: string, employeeId: string, approval: AttendanceApproval) {
  const code = state.attendance[date]?.[employeeId];
  if (code !== "H" && code !== "A") return state;
  return {
    ...state,
    attendanceApprovals: {
      ...state.attendanceApprovals,
      [date]: { ...(state.attendanceApprovals[date] || {}), [employeeId]: approval }
    }
  };
}

export function deleteEmployee(state: HrState, employeeId: string) {
  const loanIds = new Set((state.loans ?? []).filter(loan => loan.employeeId === employeeId).map(loan => loan.id));
  const attendance = Object.fromEntries(Object.entries(state.attendance).flatMap(([date, records]) => {
    const day = { ...records };
    delete day[employeeId];
    return Object.keys(day).length ? [[date, day]] : [];
  }));
  const attendanceApprovals = Object.fromEntries(Object.entries(state.attendanceApprovals).flatMap(([date, records]) => {
    const day = { ...records };
    delete day[employeeId];
    return Object.keys(day).length ? [[date, day]] : [];
  }));

  return {
    ...state,
    employees: state.employees.filter(employee => employee.id !== employeeId),
    attendance,
    attendanceApprovals,
    leaves: state.leaves.filter(item => item.employeeId !== employeeId),
    payroll: state.payroll.filter(item => item.employeeId !== employeeId),
    businessTrips: state.businessTrips.filter(item => item.employeeId !== employeeId),
    expenses: state.expenses.filter(item => item.employeeId !== employeeId),
    loans: (state.loans ?? []).filter(item => item.employeeId !== employeeId),
    loanRepayments: (state.loanRepayments ?? []).filter(item => !loanIds.has(item.loanId)),
    eosRecords: state.eosRecords.filter(item => item.employeeId !== employeeId),
    documents: state.documents.filter(item => item.employeeId !== employeeId)
  };
}

export function markAllAttendance(state: HrState, date: string, code: AttendanceCode) {
  const existing = state.attendance[date] || {};
  const day = Object.fromEntries(activeEmployees(state.employees).map(employee => [employee.id, existing[employee.id] === "L" ? "L" : code]));
  const attendanceApprovals = { ...state.attendanceApprovals };
  delete attendanceApprovals[date];
  return { ...state, attendance: { ...state.attendance, [date]: day }, attendanceApprovals };
}

export function clearAttendanceDay(state: HrState, date: string) {
  const attendance = { ...state.attendance };
  const leave = Object.fromEntries(Object.entries(attendance[date] || {}).filter(([, code]) => code === "L"));
  if (Object.keys(leave).length) attendance[date] = leave;
  else delete attendance[date];
  const attendanceApprovals = { ...state.attendanceApprovals };
  delete attendanceApprovals[date];
  return { ...state, attendance, attendanceApprovals };
}

export function decideLeave(state: HrState, id: string, status: LeaveStatus) {
  const leave = state.leaves.find(item => item.id === id);
  if (!leave) return state;

  const leaves = state.leaves.map(item => item.id === id ? { ...item, status, decidedOn: todayISO() } : item);
  let attendance = leave.status === "Approved" ? clearLeaveAttendance(state.attendance, leave, leaves) : state.attendance;
  let employees = leave.status === "Approved" ? applyLeaveBalance(state.employees, state.settings, leave, -1) : state.employees;

  if (status === "Approved") {
    attendance = { ...attendance };
    const start = isoDate(leave.from);
    const end = isoDate(leave.to);
    for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
      const key = day.toISOString().slice(0, 10);
      attendance[key] = { ...(attendance[key] || {}), [leave.employeeId]: "L" };
    }
    employees = applyLeaveBalance(employees, state.settings, leave, 1);
  }

  return { ...state, employees, leaves, attendance };
}

export function deleteLeave(state: HrState, id: string) {
  const leave = state.leaves.find(item => item.id === id);
  if (!leave) return state;
  const reverted = leave.status === "Approved"
    ? {
        ...state,
        employees: applyLeaveBalance(state.employees, state.settings, leave, -1),
        attendance: clearLeaveAttendance(state.attendance, leave, state.leaves.filter(item => item.id !== id))
      }
    : state;
  return { ...reverted, leaves: reverted.leaves.filter(item => item.id !== id) };
}

export function createPayroll(state: HrState, year: number, month: number) {
  const stats = attendanceStats(state.employees, state.attendance, year, month);
  const newSlips: PayrollSlip[] = [];
  let updated = 0;

  for (const employee of activeEmployees(state.employees)) {
    const existing = state.payroll.find(item => item.year === year && item.month === month && item.employeeId === employee.id);
    if (existing?.status === "Finalized") continue;
    const salary = employeeSalary(employee);
    const employeeStats = stats.find(item => item.employee.id === employee.id);
    const lopDays = (employeeStats?.A ?? 0) + (employeeStats?.H ?? 0) * 0.5 + unpaidLeaveDays(state, employee.id, year, month);
    const lopAmount = Math.round((salary.total / 30) * lopDays * 100) / 100;
    const gross = salary.basic + salary.housing + salary.allowances + salary.overtime;
    const deductions = 0;
    const loanDeductions = payrollLoanDeductions(state, employee, year, month, gross - deductions - lopAmount);
    const loanDeduction = roundMoney(loanDeductions.reduce((sum, item) => sum + item.amount, 0));
    const net = Math.max(0, roundMoney(gross - deductions - lopAmount - loanDeduction));

    const slip: PayrollSlip = {
      id: existing?.id ?? newId(),
      employeeId: employee.id,
      year,
      month,
      basic: salary.basic,
      housing: salary.housing,
      allowances: salary.allowances,
      overtime: salary.overtime,
      bonus: 0,
      deductions,
      loanDeduction,
      loanDeductions,
      lopDays,
      lopAmount,
      gross,
      net,
      note: existing?.note ?? "",
      status: "Draft"
    };
    if (existing) updated += 1;
    newSlips.push(slip);
  }

  const payroll = [
    ...state.payroll.filter(item => item.year !== year || item.month !== month || !newSlips.some(slip => slip.employeeId === item.employeeId)),
    ...newSlips
  ];
  return { state: { ...state, payroll }, created: newSlips.length - updated, updated };
}

export function loanBalance(state: HrState, loanId: string) {
  const loan = (state.loans ?? []).find(item => item.id === loanId);
  if (!loan) return 0;
  const paid = (state.loanRepayments ?? [])
    .filter(item => item.loanId === loanId && item.status === "Posted")
    .reduce((sum, item) => sum + item.amount, 0);
  return Math.max(0, roundMoney(loan.principal - paid));
}

export function loanScheduledAmount(loan: EmployeeLoan) {
  if (loan.repaymentMode === "Manual") return 0;
  const amount = loan.repaymentMode === "Duration"
    ? loan.principal / Math.max(1, loan.termMonths)
    : loan.monthlyLimit;
  return roundMoney(loan.monthlyLimit > 0 ? Math.min(amount, loan.monthlyLimit) : amount);
}

export function loanEstimatedMonths(state: HrState, loan: EmployeeLoan) {
  const employee = state.employees.find(item => item.id === loan.employeeId);
  const installment = Math.min(loanScheduledAmount(loan), employee ? companyLoanDeductionCap(state.settings, employeeSalary(employee).total) : Number.POSITIVE_INFINITY);
  return installment > 0 ? Math.ceil(loanBalance(state, loan.id) / installment) : 0;
}

export function loanEstimatedEndPeriod(state: HrState, loan: EmployeeLoan, fromPeriod = monthKey(new Date().getFullYear(), new Date().getMonth() + 1)) {
  const monthsRemaining = loanEstimatedMonths(state, loan);
  if (!monthsRemaining || !/^\d{4}-\d{2}$/.test(loan.startPeriod)) return "-";
  return addPeriodMonths(loan.startPeriod > fromPeriod ? loan.startPeriod : fromPeriod, monthsRemaining - 1);
}

export function companyLoanDeductionCap(settings: HrSettings, grossPay: number) {
  const value = Math.max(0, Number(settings.loanDeductionCap?.value) || 0);
  if (!value) return Number.POSITIVE_INFINITY;
  return settings.loanDeductionCap?.type === "Percent"
    ? roundMoney(grossPay * Math.min(100, value) / 100)
    : roundMoney(value);
}

export function payrollLoanDeductions(state: HrState, employee: EmployeeRecord, year: number, month: number, availablePay: number): PayrollLoanDeduction[] {
  const period = monthKey(year, month);
  const gross = employeeSalary(employee).total;
  const companyCap = companyLoanDeductionCap(state.settings, gross);
  let companyUsed = 0;
  let payRemaining = Math.max(0, availablePay);
  const deductions: PayrollLoanDeduction[] = [];
  const loans = (state.loans ?? [])
    .filter(loan => loan.employeeId === employee.id && loan.status === "Active" && loan.startPeriod <= period)
    .slice()
    .sort((a, b) => a.startPeriod.localeCompare(b.startPeriod) || a.createdOn.localeCompare(b.createdOn) || a.id.localeCompare(b.id));

  for (const loan of loans) {
    const balance = loanBalance(state, loan.id);
    const override = loan.deductionOverrides?.[period];
    let amount = override ? override.amount : loanScheduledAmount(loan);
    if (amount <= 0 || balance <= 0 || payRemaining <= 0) continue;
    if (!override?.approvedAboveLimit) {
      if (loan.monthlyLimit > 0) amount = Math.min(amount, loan.monthlyLimit);
      amount = Math.min(amount, Math.max(0, companyCap - companyUsed));
    }
    amount = roundMoney(Math.min(amount, balance, payRemaining));
    if (!amount) continue;
    deductions.push({ loanId: loan.id, amount });
    companyUsed = roundMoney(companyUsed + amount);
    payRemaining = roundMoney(payRemaining - amount);
  }
  return deductions;
}

export function setLoanDeductionOverride(state: HrState, loanId: string, period: string, amount: number | undefined, reason = "", approvedAboveLimit = false) {
  if (!/^\d{4}-\d{2}$/.test(period)) return state;
  return {
    ...state,
    loans: (state.loans ?? []).map(loan => {
      if (loan.id !== loanId) return loan;
      const deductionOverrides = { ...(loan.deductionOverrides ?? {}) };
      if (amount === undefined) delete deductionOverrides[period];
      else if (Number.isFinite(amount) && amount >= 0 && reason.trim()) deductionOverrides[period] = { amount: roundMoney(amount), reason: reason.trim(), approvedAboveLimit, updatedOn: todayISO() };
      return { ...loan, deductionOverrides };
    })
  };
}

export function recordManualLoanRepayment(state: HrState, loanId: string, amount: number, note: string, postedOn = todayISO()) {
  const date = parseDateParts(postedOn);
  if (!date || amount <= 0 || amount > loanBalance(state, loanId)) return state;
  const next = {
    ...state,
    loanRepayments: [...(state.loanRepayments ?? []), {
      id: newId(), loanId, year: date.getFullYear(), month: date.getMonth() + 1, amount: roundMoney(amount), source: "Manual" as const,
      status: "Posted" as const, note: note.trim(), postedOn
    }]
  };
  return settleLoans(next);
}

export function finalizePayrollSlip(state: HrState, slipId: string) {
  const slip = state.payroll.find(item => item.id === slipId);
  if (!slip || slip.status === "Finalized") return state;
  const employee = state.employees.find(item => item.id === slip.employeeId);
  const loanDeductions = employee ? payrollLoanDeductions(state, employee, slip.year, slip.month, slip.gross - slip.deductions - slip.lopAmount) : [];
  const finalSlip = recalcSlip({ ...slip, loanDeductions, loanDeduction: roundMoney(loanDeductions.reduce((sum, item) => sum + item.amount, 0)), status: "Finalized" });
  const loanRepayments = [...(state.loanRepayments ?? [])];
  for (const deduction of finalSlip.loanDeductions) {
    if (loanRepayments.some(item => item.payrollId === finalSlip.id && item.loanId === deduction.loanId && item.status === "Posted")) continue;
    loanRepayments.push({
      id: newId(), loanId: deduction.loanId, payrollId: finalSlip.id, year: finalSlip.year, month: finalSlip.month, amount: deduction.amount,
      source: "Payroll", status: "Posted", note: `Payroll ${monthKey(finalSlip.year, finalSlip.month)}`, postedOn: todayISO()
    });
  }
  return settleLoans({
    ...state,
    loanRepayments,
    payroll: state.payroll.map(item => item.id === slipId ? finalSlip : item)
  });
}

export function settlementSummary(employee: EmployeeRecord, state: HrState, asOf = todayISO()) {
  const salary = employeeSalary(employee);
  const years = serviceYears(employee.fields["Joining Date"], asOf);
  // ponytail: Qatar Article 54 minimum; replace here if company policy pays more.
  const gratuity = years >= 1 ? roundMoney((salary.basic / 30) * 21 * years) : 0;
  const annualBalance = Math.max(0, numberField(employee.fields["Annual Leave Balance"]) ?? leaveBalanceSummary(state, employee.id, "Annual leave").remaining);
  const leaveEncashment = roundMoney((salary.basic / 30) * annualBalance);
  const lopDays = numberField(employee.fields["LOP Days (Loss of Pay)"]) ?? 0;
  const lopDeduction = roundMoney((salary.total / 30) * lopDays);
  return {
    asOf,
    years,
    basic: salary.basic,
    monthlyTotal: salary.total,
    annualBalance,
    gratuity,
    leaveEncashment,
    lopDays,
    lopDeduction,
    netSettlement: roundMoney(gratuity + leaveEncashment - lopDeduction)
  };
}

export function tripTotal(trip: Pick<BusinessTrip, "days" | "perDiem" | "travelCost">) {
  return roundMoney(trip.days * trip.perDiem + trip.travelCost);
}

export function expenseTotals(expenses: EmployeeExpense[]) {
  return {
    submitted: roundMoney(expenses.filter(item => item.status === "Submitted").reduce((sum, item) => sum + item.amount, 0)),
    approved: roundMoney(expenses.filter(item => item.status === "Approved").reduce((sum, item) => sum + item.amount, 0)),
    paid: roundMoney(expenses.filter(item => item.status === "Paid").reduce((sum, item) => sum + item.amount, 0))
  };
}

export function candidatePipeline(candidates: RecruitmentCandidate[]) {
  return candidateStages.reduce((counts, stage) => {
    counts[stage] = candidates.filter(item => item.stage === stage).length;
    return counts;
  }, {} as Record<CandidateStage, number>);
}

export function hireCandidateAsEmployee(state: HrState, candidateId: string) {
  const candidate = state.candidates.find(item => item.id === candidateId);
  if (!candidate || candidate.stage !== "Hired" || candidate.employeeId) return state;

  const job = state.jobs.find(item => item.id === candidate.jobId);
  const parts = candidate.name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] || candidate.name.trim();
  const last = parts.slice(1).join(" ");
  const employee = createEmptyEmployee(nextEmployeeCode(state.employees));
  const annualLeave = state.settings.leaveTypes.find(item => item.name.toLowerCase().includes("annual"))?.days ?? 30;
  const hiredEmployee = normalizeEmployee({
    ...employee,
    status: "Active",
    fields: {
      ...employee.fields,
      "First Name": first,
      "Last Name": last,
      "Full Name": candidate.name.trim(),
      Department: job?.dept || "",
      Designation: job?.title || "",
      "Business Unit": job?.dept || "",
      "Joining Date": todayISO(),
      "Hire Type": "Recruitment",
      "Personal Mobile No.": candidate.phone,
      "Office Mobile No.": candidate.phone,
      "E-Mail ID (Work)": candidate.email,
      "Annual Leave Balance": String(annualLeave)
    }
  });

  return {
    ...state,
    employees: [...state.employees, hiredEmployee],
    candidates: state.candidates.map(item => item.id === candidateId
      ? {
          ...item,
          employeeId: hiredEmployee.id,
          notes: item.notes ? `${item.notes}\nHired via recruitment pipeline` : "Hired via recruitment pipeline"
        }
      : item)
  };
}

export function eosSummary(employee: EmployeeRecord, state: HrState, asOf = todayISO()) {
  const settlement = settlementSummary(employee, state, asOf);
  const expenseReimbursement = roundMoney((state.expenses ?? [])
    .filter(item => item.employeeId === employee.id && item.status === "Approved")
    .reduce((sum, item) => sum + item.amount, 0));
  const tripAdvanceDeduction = roundMoney((state.businessTrips ?? [])
    .filter(item => item.employeeId === employee.id && item.status === "Approved")
    .reduce((sum, item) => sum + item.advanceAmount, 0));
  return {
    ...settlement,
    expenseReimbursement,
    tripAdvanceDeduction,
    netSettlement: roundMoney(settlement.netSettlement + expenseReimbursement - tripAdvanceDeduction)
  };
}

export function createEosRecord(state: HrState, employee: EmployeeRecord, asOf: string, reason: string): EosRecord {
  const summary = eosSummary(employee, state, asOf);
  return {
    id: newId(),
    version: 1,
    employeeId: employee.id,
    asOf,
    reason,
    serviceYears: summary.years,
    gratuity: summary.gratuity,
    leaveEncashment: summary.leaveEncashment,
    lopDeduction: summary.lopDeduction,
    expenseReimbursement: summary.expenseReimbursement,
    tripAdvanceDeduction: summary.tripAdvanceDeduction,
    netSettlement: summary.netSettlement,
    status: "Draft",
    createdOn: todayISO()
  };
}

export function recalcSlip(slip: PayrollSlip) {
  const gross = slip.basic + slip.housing + slip.allowances + slip.overtime + slip.bonus;
  const net = Math.max(0, roundMoney(gross - slip.deductions - slip.lopAmount - (slip.loanDeduction ?? 0)));
  return { ...slip, gross, net };
}

export function upsertEmployee(state: HrState, employee: EmployeeRecord) {
  const normalized = normalizeEmployee(employee);
  const exists = state.employees.some(item => item.id === employee.id);
  return {
    ...state,
    employees: exists
      ? state.employees.map(item => item.id === employee.id ? normalized : item)
      : [...state.employees, normalized]
  };
}

export function documentNumber(state: HrState, prefix = "MTECH-HR") {
  return `${prefix}-${new Date().getFullYear()}-${String(state.settings.documentSeq + 1).padStart(4, "0")}`;
}

export function withNextDocumentSeq(state: HrState) {
  return { ...state, settings: { ...state.settings, documentSeq: state.settings.documentSeq + 1 } };
}

function clearLeaveAttendance(attendance: HrState["attendance"], leave: LeaveRequest, leaves: LeaveRequest[] = []) {
  const next = { ...attendance };
  forEachLeaveDay(leave, key => {
    if (next[key]?.[leave.employeeId] !== "L") return;
    const day = { ...next[key] };
    delete day[leave.employeeId];
    if (leaves.some(item => item.id !== leave.id && item.employeeId === leave.employeeId && item.status === "Approved" && leaveCoversDate(item, key))) {
      day[leave.employeeId] = "L";
    }
    next[key] = day;
  });
  return next;
}

function leaveDaysInYear(leave: LeaveRequest, year: number) {
  return roundMoney([...leaveDayWeights([leave], String(year)).values()].reduce((sum, value) => sum + value, 0));
}

function leaveDayWeights(leaves: LeaveRequest[], prefix: string) {
  const dates = new Map<string, number>();
  for (const leave of leaves) {
    const span = Math.max(1, inclusiveDays(leave.from, leave.to));
    const dailyWeight = Math.min(1, Math.max(0, Number(leave.days) || 0) / span);
    forEachLeaveDay(leave, key => {
      if (key.startsWith(prefix)) dates.set(key, Math.max(dates.get(key) ?? 0, dailyWeight));
    });
  }
  return dates;
}

function leaveCoversDate(leave: LeaveRequest, date: string) {
  return leave.from <= date && date <= leave.to;
}

function applyLeaveBalance(employees: EmployeeRecord[], settings: HrSettings, leave: LeaveRequest, direction: 1 | -1) {
  return employees.map(employee => {
    if (employee.id !== leave.employeeId) return employee;
    const fields = { ...employee.fields };
    if (isUnpaidLeave(settings, leave.type)) {
      fields["LOP Days (Loss of Pay)"] = String(Math.max(0, (numberField(fields["LOP Days (Loss of Pay)"]) ?? 0) + leave.days * direction));
    } else if (leave.type.toLowerCase().includes("annual")) {
      const current = numberField(fields["Annual Leave Balance"]) ?? settings.leaveTypes.find(item => item.name === leave.type)?.days ?? 0;
      fields["Annual Leave Balance"] = String(Math.max(0, current - leave.days * direction));
    }
    return { ...employee, fields };
  });
}

function unpaidLeaveDays(state: HrState, employeeId: string, year: number, month: number) {
  return state.leaves
    .filter(item => item.employeeId === employeeId && item.status === "Approved" && isUnpaidLeave(state.settings, item.type))
    .reduce((sum, item) => sum + leaveDaysInMonth(item, year, month), 0);
}

function leaveDaysInMonth(leave: LeaveRequest, year: number, month: number) {
  return roundMoney([...leaveDayWeights([leave], monthKey(year, month)).values()].reduce((sum, value) => sum + value, 0));
}

function forEachLeaveDay(leave: LeaveRequest, action: (key: string) => void) {
  const start = isoDate(leave.from);
  const end = isoDate(leave.to);
  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) action(day.toISOString().slice(0, 10));
}

function isoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isUnpaidLeave(settings: HrSettings, typeName: string) {
  const type = settings.leaveTypes.find(item => item.name === typeName);
  return /unpaid|lop|loss of pay/i.test(typeName) || type?.days === 0;
}

function numberField(value?: string) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function addPeriodMonths(period: string, offset: number) {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return monthKey(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

function settleLoans(state: HrState) {
  return {
    ...state,
    loans: (state.loans ?? []).map(loan => loan.status !== "Cancelled" && loanBalance(state, loan.id) <= 0 ? { ...loan, status: "Settled" as const } : loan)
  };
}

function parseDateParts(value?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : undefined;
}

function dateToISO(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

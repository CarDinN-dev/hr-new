import type { AttendanceCode, BusinessTrip, CandidateStage, EmployeeExpense, EmployeeRecord, EosRecord, HrSettings, HrState, LeaveRequest, LeaveStatus, PayrollSlip, RecruitmentCandidate } from "./data";
import { candidateStages, createEmptyEmployee, months, normalizeEmployee } from "./data";
import { newId } from "./id";

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
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
  const allowances = moneyValue(fields["Food Allowance"]) + moneyValue(fields["Mobile Allowance"]) + moneyValue(fields["Special Allowance"]) + moneyValue(fields["Transport Allowance"]);
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
  if (!joiningDate) return 0;
  const joined = new Date(`${joiningDate}T00:00:00`);
  const end = new Date(`${asOf}T00:00:00`);
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

export function leaveBalanceSummary(state: HrState, employeeId: string, typeName: string, year = new Date().getFullYear()) {
  const type = state.settings.leaveTypes.find(item => item.name === typeName);
  const total = type?.days ?? 0;
  const requests = state.leaves.filter(item => item.employeeId === employeeId && item.type === typeName && leaveDaysInYear(item, year) > 0);
  const usedDates = leaveDateSet(requests.filter(item => item.status === "Approved"), year);
  const pendingDates = leaveDateSet(requests.filter(item => item.status === "Pending"), year);
  const used = usedDates.size;
  const pending = [...pendingDates].filter(key => !usedDates.has(key)).length;
  return { total, used, pending, remaining: total - used - pending };
}

export function setAttendance(state: HrState, date: string, employeeId: string, code: AttendanceCode) {
  const attendance = { ...state.attendance, [date]: { ...(state.attendance[date] || {}) } };
  if (attendance[date][employeeId] === code) delete attendance[date][employeeId];
  else attendance[date][employeeId] = code;
  return { ...state, attendance };
}

export function markAllAttendance(state: HrState, date: string, code: AttendanceCode) {
  const day = Object.fromEntries(activeEmployees(state.employees).map(employee => [employee.id, code]));
  return { ...state, attendance: { ...state.attendance, [date]: day } };
}

export function clearAttendanceDay(state: HrState, date: string) {
  const attendance = { ...state.attendance };
  delete attendance[date];
  return { ...state, attendance };
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
    const net = Math.max(0, Math.round((gross - deductions - lopAmount) * 100) / 100);

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
  const net = Math.max(0, Math.round((gross - slip.deductions - slip.lopAmount) * 100) / 100);
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
  let days = 0;
  forEachLeaveDay(leave, key => {
    if (key.startsWith(String(year))) days += 1;
  });
  return days;
}

function leaveDateSet(leaves: LeaveRequest[], year: number) {
  const dates = new Set<string>();
  for (const leave of leaves) {
    forEachLeaveDay(leave, key => {
      if (key.startsWith(String(year))) dates.add(key);
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
  let days = 0;
  forEachLeaveDay(leave, key => {
    if (key.startsWith(monthKey(year, month))) days += 1;
  });
  return days;
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

function parseDateParts(value?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(Number(date)) ? undefined : date;
}

function dateToISO(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

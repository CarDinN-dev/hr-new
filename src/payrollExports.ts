import type { HrSettings, HrState, PayrollSlip } from "./data";
import { attendanceStats, employeeName } from "./domain";

const sifHeader = ["Employer Establishment ID (Employer EID)", "File Creation Date", "File Creation Time", "Payer Establishment ID (Payer EID)", "Payer QID", "Payer Bank Short Name", "Payer IBAN", "Salary Year and Month", "Total Salaries", "Number of Records"];
const sifRecord = ["Record Sequence", "Employee QID", "Employee Visa ID", "Employee Name", "Employee Bank Short Name", "Employee Account", "Salary Frequency", "Number of Working days", "Net Salary", "Basic Salary", "Extra hours", "Extra income", "Deductions", "Payment Type", "Notes / Comments"];

export function payrollSlipsForDepartment(state: HrState, slips: PayrollSlip[], department: string) {
  return slips.filter(slip => state.employees.find(employee => employee.id === slip.employeeId)?.fields.Department === department);
}

export function payrollSheetHtml(state: HrState, slips: PayrollSlip[]) {
  const rows = slips.map(slip => {
    const employee = state.employees.find(item => item.id === slip.employeeId);
    return [employee?.fields["Employee Code"] ?? "", employeeName(employee), employee?.fields.Department ?? "", employee?.fields["Bank Code"] ?? "", employee?.fields["IBAN No."] || employee?.fields["Account No."] || "", slip.basic, slip.allowances + slip.housing + slip.overtime + slip.bonus, slip.deductions, slip.loanDeduction ?? 0, slip.lopAmount, slip.net, slip.status];
  });
  return tableHtml(["Employee Code", "Employee", "Department", "Bank", "IBAN / Account", "Basic", "Extra Income", "Other Deductions", "Loan Deduction", "LOP", "Net Pay", "Status"], rows);
}

export function sifCsv(state: HrState, slips: PayrollSlip[], year: number, month: number) {
  const now = new Date();
  const settings = state.settings.company as HrSettings["company"] & Record<string, string>;
  const header = [
    settings.wpsEmployerEid || "",
    compactDate(now),
    compactTime(now),
    settings.wpsPayerEid || settings.wpsEmployerEid || "",
    settings.wpsPayerQid || "",
    settings.wpsPayerBank || "",
    settings.wpsPayerIban || "",
    `${year}${String(month).padStart(2, "0")}`,
    money(slips.reduce((sum, slip) => sum + slip.net, 0)),
    String(slips.length)
  ];
  const stats = attendanceStats(state.employees, state.attendance, year, month);
  const records = slips.map((slip, index) => {
    const employee = state.employees.find(item => item.id === slip.employeeId);
    const employeeStats = stats.find(item => item.employee.id === slip.employeeId);
    const workingDays = Math.max(0, Math.round(daysInMonth(year, month) - slip.lopDays));
    return [
      String(index + 1).padStart(6, "0"),
      employee?.fields["RP/ID Number"] || "",
      "",
      employeeName(employee),
      employee?.fields["Bank Code"] || "",
      employee?.fields["IBAN No."] || employee?.fields["Account No."] || "",
      "M",
      String(workingDays),
      money(slip.net),
      money(slip.basic),
      "0",
      money(slip.housing + slip.allowances + slip.overtime + slip.bonus),
      money(slip.deductions + (slip.loanDeduction ?? 0) + slip.lopAmount),
      "Normal Payment",
      employeeStats?.A || employeeStats?.H ? `Attendance LOP ${slip.lopDays} days` : ""
    ];
  });
  return [sifHeader, header, sifRecord, ...records].map(row => row.map(csvCell).join(",")).join("\r\n");
}

export function payrollExportWarnings(state: HrState, slips: PayrollSlip[]) {
  const company = state.settings.company as HrSettings["company"] & Record<string, string>;
  const warnings = [];
  if (!company.wpsEmployerEid) warnings.push("Employer EID missing");
  if (!company.wpsPayerBank) warnings.push("Payer bank missing");
  if (!company.wpsPayerIban) warnings.push("Payer IBAN missing");
  const missingEmployees = slips.filter(slip => {
    const employee = state.employees.find(item => item.id === slip.employeeId);
    return !employee?.fields["RP/ID Number"] || !employee.fields["Bank Code"] || !(employee.fields["IBAN No."] || employee.fields["Account No."]);
  }).length;
  if (missingEmployees) warnings.push(`${missingEmployees} employee bank/QID record(s) incomplete`);
  return warnings;
}

function tableHtml(headers: string[], rows: Array<Array<string | number>>) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><table><thead><tr>${headers.map(tag("th")).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => tag("td")(String(value))).join("")}</tr>`).join("")}</tbody></table></body></html>`;
}

function tag(name: "th" | "td") {
  return (value: string) => `<${name}>${escapeHtml(value)}</${name}>`;
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
}

function money(value: number) {
  return Number(value || 0).toFixed(2);
}

function compactDate(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function compactTime(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

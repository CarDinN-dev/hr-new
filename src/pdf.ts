import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { RowInput } from "jspdf-autotable";
import type { EmployeeRecord, EosRecord, HrSettings, HrState, PdfTemplate, PayrollSlip } from "./data";
import { months, pdfTemplates, reportTemplates } from "./data";
import { attendanceStats, employeeName, employeeSalary, eosSummary, formatDate, formatMoney, moneyValue } from "./domain";
import { buildCompanyRoleHierarchy, type RoleHierarchyMember } from "./roleHierarchy";

type AutoTableDoc = jsPDF & { lastAutoTable?: { finalY: number } };
export type GeneratedPdf = { filename: string; dataUrl: string; sizeBytes: number };

const page = { width: 210, height: 297, margin: 14 };
const brand = {
  ink: [24, 31, 43] as [number, number, number],
  red: [217, 39, 62] as [number, number, number],
  muted: [95, 107, 122] as [number, number, number],
  line: [218, 223, 230] as [number, number, number],
  soft: [247, 248, 250] as [number, number, number]
};

export function saveEmployeeProfilePdf(employee: EmployeeRecord, settings: HrSettings) {
  const { doc, y } = brandedDoc(settings, "Employee Profile", `${employee.fields["Employee Code"]} - ${employeeName(employee)}`);
  const nextY = employeeIdentity(doc, y, employee);
  const rows = [
    ["Employee Code", employee.fields["Employee Code"], "Status", employee.status],
    ["Department", employee.fields.Department, "Designation", employee.fields.Designation],
    ["Manager", employee.fields["Reporting Manager Employee Code/Name"], "Joining Date", formatDate(employee.fields["Joining Date"])],
    ["Work Email", employee.fields["E-Mail ID (Work)"], "Mobile", employee.fields["Personal Mobile No."] || employee.fields["Office Mobile No."]],
    ["Nationality", employee.fields.Nationality, "QID Expiry", formatDate(employee.fields["QID Expiry Date"])],
    ["Basic", moneyText(employee.fields.Basic, settings), "Total", moneyText(employee.fields.Total, settings)],
    ["Bank", employee.fields["Bank Code"], "IBAN", employee.fields["IBAN No."]],
    ["Emergency Contact", employee.fields["Emergency Contact Name"], "Emergency Phone", employee.fields["Emergency Contact Mobile No."]]
  ];
  table(doc, sectionTitle(doc, nextY + 5, "Employment and contact details"), [], rows.map(labelCells));
  return finish(doc, settings, `Profile-${safe(employee.fields["Employee Code"])}.pdf`);
}

export function saveReportPdf(template: PdfTemplate, state: HrState, year: number, month: number) {
  const settings = state.settings;
  if (template === "employee_directory") return employeeDirectory(state, settings);
  if (template === "attendance_report") return attendanceReport(state, settings, year, month);
  if (template === "leave_report") return leaveReport(state, settings, year);
  if (template === "payroll_register") return payrollRegister(state, settings, year, month);
  if (template === "headcount_report") return headcountReport(state, settings);
}

export function savePayslipPdf(slip: PayrollSlip, employee: EmployeeRecord, settings: HrSettings) {
  const { doc, y } = brandedDoc(settings, "Payslip", `${months[slip.month - 1]} ${slip.year}`);
  let nextY = employeeIdentity(doc, y, employee);
  nextY = table(doc, sectionTitle(doc, nextY + 5, "Employee details"), [], [
    labelCells(["Employee", employeeName(employee), "Employee Code", employee.fields["Employee Code"]]),
    labelCells(["Designation", employee.fields.Designation, "Department", employee.fields.Department]),
    labelCells(["Joining Date", formatDate(employee.fields["Joining Date"]), "Bank", employee.fields["Bank Code"]])
  ]);

  nextY = table(doc, sectionTitle(doc, nextY + 7, "Pay calculation"), [["Earnings", "Amount", "Deductions", "Amount"]], [
    ["Basic", money(slip.basic, settings), "Loss of pay", money(slip.lopAmount, settings)],
    ["Housing", money(slip.housing, settings), "Deductions", money(slip.deductions, settings)],
    ["Allowances", money(slip.allowances, settings), "Loan deduction", money(slip.loanDeduction ?? 0, settings)],
    ["Overtime", money(slip.overtime, settings), "", ""],
    ["Bonus", money(slip.bonus, settings), "", ""],
    ["Gross", money(slip.gross, settings), "Net Pay", money(slip.net, settings)]
  ]);

  nextY = summaryBand(doc, nextY + 7, "Net pay", money(slip.net, settings));
  doc.setTextColor(...brand.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text("Computer-generated payslip. Payroll status: " + slip.status + ".", page.margin, nextY + 7);
  return finish(doc, settings, `Payslip-${safe(employee.fields["Employee Code"])}-${slip.year}-${String(slip.month).padStart(2, "0")}.pdf`);
}

export function saveEmployeeDocumentPdf(template: PdfTemplate, employee: EmployeeRecord, state: HrState, notes: string) {
  const settings = state.settings;
  if (template === "payslip") {
    const slip = latestSlip(state, employee) ?? provisionalSlip(employee);
    return savePayslipPdf(slip, employee, settings);
  }

  const label = pdfTemplates.find(item => item.id === template)?.label ?? "HR Document";
  const { doc, y } = brandedDoc(settings, label, `${employee.fields["Employee Code"]} - ${employeeName(employee)}`);
  let nextY = y;

  if (template === "leave_approval") {
    const leave = [...state.leaves].reverse().find(item => item.employeeId === employee.id);
    nextY = table(doc, nextY, [["Leave Application", "Details"]], [
      ["Employee", employeeName(employee)],
      ["Leave Type", leave?.type ?? "Annual leave"],
      ["Period", leave ? `${formatDate(leave.from)} to ${formatDate(leave.to)}` : "To be confirmed"],
      ["Days", String(leave?.days ?? 0)],
      ["Status", leave?.status ?? "Pending"]
    ]);
    paragraph(doc, nextY + 6, notes || "Generated using the MedTech leave approval format for HR records.");
    return finish(doc, settings, `${safe(label)}-${safe(employee.fields["Employee Code"])}.pdf`);
  }

  if (template === "final_settlement" || template === "gratuity_statement" || template === "clearance_certificate") {
    const settlement = eosSummary(employee, state);
    nextY = table(doc, nextY, [["Settlement Field", "Value"]], [
      ["Employee", employeeName(employee)],
      ["Settlement Date", formatDate(settlement.asOf)],
      ["Completed Service", `${settlement.years.toFixed(2)} years`],
      ["Basic Salary", money(settlement.basic, settings)],
      ["Estimated Gratuity", money(settlement.gratuity, settings)],
      ["Leave Encashment", money(settlement.leaveEncashment, settings)],
      ["LOP Deduction", money(settlement.lopDeduction, settings)],
      ["Approved Expense Reimbursement", money(settlement.expenseReimbursement, settings)],
      ["Open Trip Advance Deduction", money(settlement.tripAdvanceDeduction, settings)],
      ["Net Settlement", money(settlement.netSettlement, settings)],
      ["Clearance", template === "clearance_certificate" ? "Pending department clearances" : "Subject to final approval"]
    ]);
    paragraph(doc, nextY + 6, notes || "Values are draft HR estimates based on basic salary, recorded leave balance and LOP days, pending finance validation and management approval.");
    return finish(doc, settings, `${safe(label)}-${safe(employee.fields["Employee Code"])}.pdf`);
  }

  const salary = employeeSalary(employee);
  const paragraphs = documentParagraphs(template, employee, settings, notes);
  nextY = recipientBlock(doc, nextY, employee, label);
  nextY = table(doc, sectionTitle(doc, nextY + 4, "Employee summary"), [], [
    labelCells(["Employee", employeeName(employee), "Department", employee.fields.Department]),
    labelCells(["Designation", employee.fields.Designation, "Joining Date", formatDate(employee.fields["Joining Date"])]),
    labelCells(["Monthly Package", money(salary.total, settings), "Status", employee.status])
  ]);
  nextY += 10;

  for (const text of paragraphs) nextY = paragraph(doc, nextY, text);
  signature(doc, Math.max(nextY + 10, 235), settings);
  return finish(doc, settings, `${safe(label)}-${safe(employee.fields["Employee Code"])}.pdf`);
}

export function saveEosPdf(record: EosRecord, employee: EmployeeRecord, settings: HrSettings) {
  const { doc, y } = brandedDoc(settings, "EOS Settlement", `${employee.fields["Employee Code"]} - ${employeeName(employee)}`);
  table(doc, y, [["Field", "Value"]], [
    ["Employee", employeeName(employee)],
    ["Employee Code", employee.fields["Employee Code"]],
    ["Settlement Date", formatDate(record.asOf)],
    ["Reason", record.reason],
    ["Completed Service", `${record.serviceYears.toFixed(2)} years`],
    ["Gratuity", money(record.gratuity, settings)],
    ["Leave Encashment", money(record.leaveEncashment, settings)],
    ["LOP Deduction", money(record.lopDeduction, settings)],
    ["Approved Expenses", money(record.expenseReimbursement, settings)],
    ["Open Trip Advances", money(record.tripAdvanceDeduction, settings)],
    ["Net EOS Payable", money(record.netSettlement, settings)],
    ["Status", record.status]
  ]);
  return finish(doc, settings, `EOS-${safe(employee.fields["Employee Code"])}-${record.asOf}.pdf`);
}

export function saveRoleHierarchyPdf(employees: EmployeeRecord[], settings: HrSettings) {
  const hierarchy = buildCompanyRoleHierarchy(employees);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: "Company Role Hierarchy", subject: "Departments and saved reporting responsibilities", author: settings.company.legalName, creator: "MedTech HR ERP" });
  const departmentPages = hierarchy.departments.length ? chunk(hierarchy.departments, 4) : [[]];

  departmentPages.forEach((departments, pageIndex) => {
    if (pageIndex) doc.addPage();
    roleHierarchyPageTitle(doc, "Company Role Hierarchy", `${hierarchy.activeEmployees.length} active employees · ${hierarchy.departments.length} departments · ${hierarchy.managerCount} managers · ${hierarchy.lineManagerCount} line managers`);
    roleHierarchyBox(doc, 116, 35, 65, 12, "Executive leadership", ["COO · CPO"], "leadership");
    const executiveXs = [61, 166];
    hierarchy.executives.forEach((executive, index) => {
      const names = executive.members.length ? executive.members.map(member => member.name) : ["Position not assigned"];
      roleHierarchyBox(doc, executiveXs[index], 57, 70, 29, `${executive.code} · ${executive.label}`, names, "executive");
      roleHierarchyConnector(doc, 148.5, 47, executiveXs[index] + 35, 57);
    });
    const boxWidth = 58;
    const gap = 10;
    const totalWidth = departments.length * boxWidth + Math.max(0, departments.length - 1) * gap;
    const firstX = (297 - totalWidth) / 2;
    departments.forEach((department, index) => {
      const x = firstX + index * (boxWidth + gap);
      roleHierarchyConnector(doc, 148.5, 86, x + boxWidth / 2, 116);
      roleHierarchyBox(doc, x, 116, boxWidth, 32, department.name, [`${department.memberCount} employees`, "Manager > Line Manager > Employee"], "department");
    });
    if (!departments.length) roleHierarchyEmpty(doc, "No active employees are available below executive leadership.");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...brand.muted);
    doc.text("Department overview", 148.5, 158, { align: "center" });
  });

  hierarchy.departments.forEach(department => {
    doc.addPage();
    roleHierarchyPageTitle(doc, department.name, `${department.memberCount} employees · saved reporting hierarchy`);
    roleHierarchyBox(doc, 103.5, 36, 90, 24, department.name, [`${department.memberCount} active employees`, "Manager > Line Manager > Employee"], "department");
    const levelWidth = 82;
    const gap = 9;
    const totalWidth = department.levels.length * levelWidth + Math.max(0, department.levels.length - 1) * gap;
    const firstX = (297 - totalWidth) / 2;
    department.levels.forEach((level, index) => {
      const x = firstX + index * (levelWidth + gap);
      if (index === 0) roleHierarchyConnector(doc, 148.5, 60, x + levelWidth / 2, 82);
      else roleHierarchyHorizontalConnector(doc, x - gap, x, 92);
      roleHierarchyRoleBox(doc, x, 82, levelWidth, level.label, level.code, level.members);
    });
  });

  const pages = doc.getNumberOfPages();
  for (let current = 1; current <= pages; current += 1) {
    doc.setPage(current);
    drawRoleHierarchyChrome(doc, settings, current, pages);
  }
  const filename = "Company-Role-Hierarchy.pdf";
  const dataUrl = doc.output("datauristring");
  doc.save(filename);
  return { filename, dataUrl, sizeBytes: Math.round((dataUrl.length * 3) / 4) };
}

function chunk<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

function roleHierarchyPageTitle(doc: jsPDF, title: string, subtitle: string) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(...brand.ink);
  doc.text(title, 14, 31);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...brand.muted);
  doc.text(subtitle, 14, 36);
}

function roleHierarchyConnector(doc: jsPDF, sourceX: number, sourceY: number, targetX: number, targetY: number) {
  const middleY = sourceY + (targetY - sourceY) / 2;
  doc.setDrawColor(74, 119, 181);
  doc.setLineWidth(0.45);
  doc.line(sourceX, sourceY, sourceX, middleY);
  doc.line(sourceX, middleY, targetX, middleY);
  doc.line(targetX, middleY, targetX, targetY);
  doc.setFillColor(74, 119, 181);
  doc.triangle(targetX - 1.2, targetY - 2, targetX + 1.2, targetY - 2, targetX, targetY, "F");
}

function roleHierarchyHorizontalConnector(doc: jsPDF, sourceX: number, targetX: number, y: number) {
  doc.setDrawColor(74, 119, 181);
  doc.setLineWidth(0.45);
  doc.line(sourceX, y, targetX - 2, y);
  doc.setFillColor(74, 119, 181);
  doc.triangle(targetX - 2, y - 1.2, targetX - 2, y + 1.2, targetX, y, "F");
}

function roleHierarchyBox(doc: jsPDF, x: number, y: number, width: number, height: number, title: string, lines: string[], kind: "leadership" | "executive" | "department") {
  const colors = kind === "leadership" ? { fill: [35, 49, 74], line: [35, 49, 74], text: [255, 255, 255] } : kind === "executive" ? { fill: [241, 246, 254], line: [74, 119, 181], text: brand.ink } : { fill: [250, 250, 251], line: [187, 198, 213], text: brand.ink };
  doc.setFillColor(...colors.fill as [number, number, number]);
  doc.setDrawColor(...colors.line as [number, number, number]);
  doc.setLineWidth(0.45);
  doc.roundedRect(x, y, width, height, 2.2, 2.2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(kind === "leadership" ? 8.5 : 8);
  doc.setTextColor(...colors.text as [number, number, number]);
  doc.text(doc.splitTextToSize(title, width - 8) as string[], x + width / 2, y + (kind === "leadership" ? 7.4 : 8), { align: "center", lineHeightFactor: 1.1 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);
  doc.setTextColor(...(kind === "leadership" ? [220, 228, 240] as [number, number, number] : brand.muted));
  doc.text(doc.splitTextToSize(lines.join("\n"), width - 8) as string[], x + width / 2, y + (kind === "leadership" ? 10.5 : 18), { align: "center", lineHeightFactor: 1.25 });
}

function roleHierarchyRoleBox(doc: jsPDF, x: number, y: number, width: number, title: string, code: string, members: RoleHierarchyMember[]) {
  const visibleMembers = members.slice(0, 8);
  const height = 42 + visibleMembers.length * 8 + (members.length > visibleMembers.length ? 6 : 0);
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(187, 198, 213);
  doc.roundedRect(x, y, width, height, 2.2, 2.2, "FD");
  doc.setFillColor(239, 244, 251);
  doc.roundedRect(x + 0.5, y + 0.5, width - 1, 21, 1.7, 1.7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...brand.ink);
  doc.text(doc.splitTextToSize(title, width - 10) as string[], x + 5, y + 7, { lineHeightFactor: 1.05 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...brand.muted);
  doc.text(`${code.replaceAll("_", " ")} · ${members.length} assigned`, x + 5, y + 17);
  visibleMembers.forEach((member, index) => {
    const memberY = y + 29 + index * 8;
    doc.setFillColor(...brand.soft);
    doc.circle(x + 6.2, memberY - 1.3, 2.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.setTextColor(...brand.ink);
    doc.text(doc.splitTextToSize(member.name, width - 19)[0], x + 11, memberY - 1.2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.8);
    doc.setTextColor(...brand.muted);
    doc.text(doc.splitTextToSize(`${member.employeeCode} · ${member.designation}`, width - 19)[0], x + 11, memberY + 2.2);
  });
  if (members.length > visibleMembers.length) doc.text(`+ ${members.length - visibleMembers.length} more employees`, x + 5, y + height - 4);
}

function roleHierarchyEmpty(doc: jsPDF, message: string) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...brand.muted);
  doc.text(message, 148.5, 118, { align: "center" });
}

function drawRoleHierarchyChrome(doc: jsPDF, settings: HrSettings, current: number, pages: number) {
  doc.setFillColor(250, 250, 251);
  doc.rect(0, 0, 297, 22, "F");
  doc.setFillColor(...brand.red);
  doc.circle(15, 9, 2.1, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...brand.ink);
  doc.text("MEDTECH", 21, 9.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.2);
  doc.setTextColor(...brand.muted);
  doc.text(settings.company.legalName.toUpperCase(), 21, 14.5);
  doc.text(`ROLE HIERARCHY · ${current}/${pages}`, 283, 11, { align: "right" });
  doc.setDrawColor(...brand.red);
  doc.setLineWidth(0.6);
  doc.line(0, 22, 297, 22);
  doc.setLineWidth(0.2);
  doc.line(14, 196, 283, 196);
  doc.setFontSize(6.2);
  doc.text(`${settings.company.address}  |  ${settings.company.email}  |  ${settings.company.phone}`, 14, 201);
  doc.text(`Confidential  |  Page ${current} of ${pages}`, 283, 201, { align: "right" });
}

function employeeDirectory(state: HrState, settings: HrSettings) {
  const { doc, y } = brandedDoc(settings, "Employee Directory", `${state.employees.length} employees`);
  table(doc, y, [["Code", "Name", "Department", "Designation", "Manager", "Joined", "Status"]], state.employees.map(employee => [
    employee.fields["Employee Code"],
    employeeName(employee),
    employee.fields.Department,
    employee.fields.Designation,
    employee.fields["Reporting Manager Employee Code/Name"],
    formatDate(employee.fields["Joining Date"]),
    employee.status
  ]), 7);
  return finish(doc, settings, "MedTech-Employee-Directory.pdf");
}

function attendanceReport(state: HrState, settings: HrSettings, year: number, month: number) {
  const { doc, y } = brandedDoc(settings, "Attendance Report", `${months[month - 1]} ${year}`);
  table(doc, y, [["Code", "Employee", "Present", "Half", "Leave", "Absent", "Attendance %"]], attendanceStats(state.employees, state.attendance, year, month).map(row => [
    row.employee.fields["Employee Code"], employeeName(row.employee), row.P, row.H, row.L, row.A, `${row.pct}%`
  ]));
  return finish(doc, settings, `Attendance-${year}-${String(month).padStart(2, "0")}.pdf`);
}

function leaveReport(state: HrState, settings: HrSettings, year: number) {
  const { doc, y } = brandedDoc(settings, "Leave Register", String(year));
  table(doc, y, [["Employee", "Type", "From", "To", "Days", "Status", "Reason"]], state.leaves.filter(item => item.from.startsWith(String(year))).map(item => {
    const employee = state.employees.find(row => row.id === item.employeeId);
    return [employeeName(employee), item.type, formatDate(item.from), formatDate(item.to), item.days, item.status, item.reason];
  }), 7);
  return finish(doc, settings, `Leave-Register-${year}.pdf`);
}

function payrollRegister(state: HrState, settings: HrSettings, year: number, month: number) {
  const slips = state.payroll.filter(item => item.year === year && item.month === month);
  const { doc, y } = brandedDoc(settings, "Payroll Register", `${months[month - 1]} ${year}`);
  table(doc, y, [["Code", "Employee", "Gross", "Other deductions", "Loans", "LOP", "Net", "Status"]], slips.map(slip => {
    const employee = state.employees.find(row => row.id === slip.employeeId);
    return [employee?.fields["Employee Code"] ?? "-", employeeName(employee), money(slip.gross, settings), money(slip.deductions, settings), money(slip.loanDeduction ?? 0, settings), money(slip.lopAmount, settings), money(slip.net, settings), slip.status];
  }), 7);
  return finish(doc, settings, `Payroll-Register-${year}-${String(month).padStart(2, "0")}.pdf`);
}

function headcountReport(state: HrState, settings: HrSettings) {
  const active = state.employees.filter(employee => employee.status === "Active" || employee.status === "On Leave");
  const rows = settings.departments.map(department => {
    const count = active.filter(employee => employee.fields.Department === department).length;
    return [department, count, active.length ? `${Math.round((count / active.length) * 100)}%` : "0%"];
  }).filter(row => Number(row[1]) > 0);
  const { doc, y } = brandedDoc(settings, "Department Headcount", `${active.length} active employees`);
  table(doc, y, [["Department", "Employees", "Share"]], rows);
  return finish(doc, settings, "Headcount-by-Department.pdf");
}

function brandedDoc(settings: HrSettings, title: string, subtitle: string) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title, subject: subtitle, author: settings.company.legalName, creator: "MedTech HR ERP" });
  doc.setTextColor(...brand.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.text(title, page.margin, 38);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...brand.muted);
  doc.text(subtitle || "Human Resources", page.margin, 45);
  doc.setDrawColor(...brand.line);
  doc.line(page.margin, 49, page.width - page.margin, 49);
  return { doc, y: 56 };
}

function table(doc: jsPDF, y: number, head: RowInput[], body: RowInput[], fontSize = 8) {
  autoTable(doc, {
    startY: y,
    head,
    body,
    theme: "plain",
    margin: { left: page.margin, right: page.margin, top: 34, bottom: 22 },
    styles: { fontSize, cellPadding: 2.8, textColor: brand.ink, lineColor: brand.line, lineWidth: 0.15, minCellHeight: 8, valign: "middle" },
    headStyles: { fillColor: brand.ink, textColor: [255, 255, 255], fontStyle: "bold", cellPadding: 3.1 },
    bodyStyles: { fillColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: brand.soft }
  });
  return (doc as AutoTableDoc).lastAutoTable?.finalY ?? y;
}

function labelCells(values: string[]): RowInput {
  return [
    { content: values[0], styles: { fontStyle: "bold" as const, fillColor: brand.soft, textColor: brand.muted, fontSize: 7 } },
    { content: values[1] || "-", styles: { fontStyle: "bold" as const } },
    { content: values[2], styles: { fontStyle: "bold" as const, fillColor: brand.soft, textColor: brand.muted, fontSize: 7 } },
    { content: values[3] || "-", styles: { fontStyle: "bold" as const } }
  ];
}

function paragraph(doc: jsPDF, y: number, text: string) {
  if (y > 260) {
    doc.addPage();
    y = 36;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...brand.ink);
  const lines = doc.splitTextToSize(text, 182) as string[];
  doc.text(lines, page.margin, y, { lineHeightFactor: 1.55 });
  return y + lines.length * 5.2 + 5;
}

function signature(doc: jsPDF, y: number, settings: HrSettings) {
  if (y > 258) {
    doc.addPage();
    y = 228;
  }
  doc.setDrawColor(...brand.line);
  const width = 52;
  const positions = [page.margin, 79, 144];
  positions.forEach(position => doc.line(position, y, position + width, y));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...brand.muted);
  doc.text("Human Resources", positions[0], y + 5);
  doc.text("Authorized signatory", positions[1], y + 5);
  doc.text("Employee acknowledgement", positions[2], y + 5);
  doc.setFontSize(6.5);
  doc.text(settings.company.legalName, positions[0], y + 10);
}

function finish(doc: jsPDF, settings: HrSettings, filename: string): GeneratedPdf {
  const pages = doc.getNumberOfPages();
  for (let current = 1; current <= pages; current += 1) {
    doc.setPage(current);
    drawPageChrome(doc, settings, current, pages);
    doc.setDrawColor(...brand.red);
    doc.line(page.margin, 282, 196, 282);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...brand.muted);
    doc.text(`${settings.company.address}  |  ${settings.company.email}  |  ${settings.company.phone}`, page.margin, 287);
    doc.text(`Confidential  |  Page ${current} of ${pages}`, 196, 287, { align: "right" });
  }
  const dataUrl = doc.output("datauristring");
  doc.save(filename);
  return { filename, dataUrl, sizeBytes: Math.round((dataUrl.length * 3) / 4) };
}

function drawPageChrome(doc: jsPDF, settings: HrSettings, current: number, pages: number) {
  doc.setFillColor(250, 250, 251);
  doc.rect(0, 0, page.width, 25, "F");
  doc.setFillColor(...brand.red);
  doc.circle(page.margin + 2, 10, 2.2, "F");
  doc.circle(page.margin + 6, 7.6, 1.45, "F");
  doc.circle(page.margin + 6.4, 12.7, 1.7, "F");
  doc.circle(page.margin + 9.7, 10.2, 1.2, "F");
  doc.setTextColor(...brand.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("MEDTECH", page.margin + 14, 10.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.4);
  doc.setTextColor(...brand.muted);
  doc.text(settings.company.legalName.toUpperCase(), page.margin + 14, 16);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.7);
  doc.text("HUMAN RESOURCES", page.width - page.margin, 10.5, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.text(`Document ${current}/${pages}`, page.width - page.margin, 16, { align: "right" });
  doc.setDrawColor(...brand.red);
  doc.setLineWidth(0.7);
  doc.line(0, 25, page.width, 25);
  doc.setLineWidth(0.2);
}

function employeeIdentity(doc: jsPDF, y: number, employee: EmployeeRecord) {
  doc.setFillColor(...brand.soft);
  doc.setDrawColor(...brand.line);
  doc.roundedRect(page.margin, y, page.width - page.margin * 2, 34, 2, 2, "FD");
  const photoX = page.margin + 4;
  const photoY = y + 4;
  if (employee.photo) {
    try {
      doc.addImage(employee.photo, "JPEG", photoX, photoY, 26, 26, undefined, "FAST");
    } catch {
      identityInitials(doc, photoX, photoY, employee);
    }
  } else {
    identityInitials(doc, photoX, photoY, employee);
  }
  doc.setTextColor(...brand.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(employeeName(employee), photoX + 32, y + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...brand.muted);
  doc.text(`${employee.fields.Designation || "No designation"}  |  ${employee.fields.Department || "Unassigned"}`, photoX + 32, y + 19);
  doc.text(`${employee.fields["Employee Code"]}  |  ${employee.status}`, photoX + 32, y + 26);
  return y + 34;
}

function identityInitials(doc: jsPDF, x: number, y: number, employee: EmployeeRecord) {
  doc.setFillColor(232, 234, 238);
  doc.roundedRect(x, y, 26, 26, 2, 2, "F");
  doc.setTextColor(...brand.red);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  const initials = employeeName(employee).split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  doc.text(initials || "HR", x + 13, y + 16, { align: "center" });
}

function sectionTitle(doc: jsPDF, y: number, title: string) {
  if (y > 270) {
    doc.addPage();
    y = 36;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...brand.red);
  doc.text(title.toUpperCase(), page.margin, y);
  return y + 4;
}

function summaryBand(doc: jsPDF, y: number, label: string, value: string) {
  doc.setFillColor(...brand.ink);
  doc.roundedRect(page.margin, y, page.width - page.margin * 2, 18, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(label.toUpperCase(), page.margin + 5, y + 11.5);
  doc.setFontSize(14);
  doc.text(value, page.width - page.margin - 5, y + 11.8, { align: "right" });
  return y + 18;
}

function recipientBlock(doc: jsPDF, y: number, employee: EmployeeRecord, subject: string) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...brand.muted);
  doc.text(`Date: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`, page.width - page.margin, y, { align: "right" });
  doc.text("To", page.margin, y);
  doc.setTextColor(...brand.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(employeeName(employee), page.margin, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(`${employee.fields.Designation || "Employee"}  |  ${employee.fields.Department || "Department"}`, page.margin, y + 12);
  doc.setFillColor(...brand.soft);
  doc.roundedRect(page.margin, y + 17, page.width - page.margin * 2, 11, 1.5, 1.5, "F");
  doc.setTextColor(...brand.ink);
  doc.setFont("helvetica", "bold");
  doc.text(`Subject: ${subject}`, page.margin + 4, y + 24);
  return y + 32;
}

function documentParagraphs(template: PdfTemplate, employee: EmployeeRecord, settings: HrSettings, notes: string) {
  const name = employeeName(employee);
  const designation = employee.fields.Designation || "the assigned position";
  const department = employee.fields.Department || "the assigned department";
  const salary = money(employeeSalary(employee).total, settings);
  const joined = formatDate(employee.fields["Joining Date"]);

  if (template === "offer_letter") return [
    `We are pleased to offer ${name} the position of ${designation} in the ${department} department of ${settings.company.legalName}.`,
    `The proposed monthly gross compensation is ${salary}, subject to verification of documents, management approval and applicable Qatar employment requirements.`,
    notes || "Please sign and return this offer as acceptance within the stated validity period."
  ];
  if (template === "appointment_letter" || template === "employment_contract") return [
    `${name} is appointed as ${designation} in ${department}, effective ${joined}.`,
    `Employment is governed by company policy, the approved compensation package of ${salary}, confidentiality obligations and applicable Qatar labour requirements.`,
    notes || "All other terms will follow the signed employment contract and approved HR policy."
  ];
  if (template === "salary_certificate") return [
    `This is to certify that ${name} is employed with ${settings.company.legalName} as ${designation} since ${joined}.`,
    `The current monthly gross salary is ${salary}.`,
    notes || "This certificate is issued upon employee request for official use."
  ];
  if (template === "experience_certificate") return [
    `This certifies that ${name} has worked with ${settings.company.legalName} as ${designation} in the ${department} department since ${joined}.`,
    notes || "During this period, the employee's service record has been maintained by Human Resources."
  ];
  if (template === "warning_letter") return [
    `This letter records a formal HR warning for ${name}, ${designation}.`,
    notes || "The employee is expected to correct the matter immediately. Repetition may lead to further disciplinary action under company policy."
  ];
  return [notes || `${name} - ${designation} - ${department}`];
}

function latestSlip(state: HrState, employee: EmployeeRecord) {
  return [...state.payroll].reverse().find(item => item.employeeId === employee.id);
}

function provisionalSlip(employee: EmployeeRecord): PayrollSlip {
  const salary = employeeSalary(employee);
  return {
    id: "preview",
    employeeId: employee.id,
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    basic: salary.basic,
    housing: salary.housing,
    allowances: salary.allowances,
    overtime: salary.overtime,
    bonus: 0,
    deductions: 0,
    loanDeduction: 0,
    loanDeductions: [],
    lopDays: 0,
    lopAmount: 0,
    gross: salary.total,
    net: salary.total,
    note: "Generated without a finalized payroll run.",
    status: "Draft"
  };
}

function money(value: number, settings: HrSettings) {
  return formatMoney(value, settings.company.currency);
}

function moneyText(value: string, settings: HrSettings) {
  return money(moneyValue(value), settings);
}

function safe(value: string) {
  return String(value || "document").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

export function templateLabel(id: PdfTemplate) {
  return pdfTemplates.find(item => item.id === id)?.label ?? reportTemplates.find(item => item.id === id)?.label ?? id;
}

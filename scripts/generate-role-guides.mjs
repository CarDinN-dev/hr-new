import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const OUTPUT_DIR = path.resolve("docs", "deliverables");
const DATE = "08 August 2026";
const BRAND = {
  ink: [24, 31, 43],
  red: [203, 42, 62],
  muted: [95, 107, 122],
  line: [218, 223, 230],
  soft: [246, 247, 249],
  blue: [47, 93, 152],
  green: [39, 112, 77],
  amber: [155, 100, 20],
};
const PAGE = { width: 210, height: 297, margin: 16, contentWidth: 178 };

function text(doc, value, x, y, options = {}) {
  doc.text(Array.isArray(value) ? value.join("\n") : String(value), x, y, options);
}

function lines(doc, value, width, size = 9.5) {
  doc.setFontSize(size);
  return doc.splitTextToSize(String(value), width);
}

function addPage(doc) {
  doc.addPage();
  return 27;
}

function ensure(doc, y, needed) {
  return y + needed > 272 ? addPage(doc) : y;
}

function section(doc, y, number, heading, intro) {
  y = ensure(doc, y, intro ? 25 : 16);
  doc.setFillColor(...BRAND.red);
  doc.roundedRect(PAGE.margin, y - 4.5, 10, 7, 1.3, 1.3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  text(doc, number, PAGE.margin + 5, y, { align: "center" });
  doc.setTextColor(...BRAND.ink);
  doc.setFontSize(13);
  text(doc, heading, PAGE.margin + 14, y);
  y += 7;
  if (intro) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.2);
    doc.setTextColor(...BRAND.muted);
    const wrapped = lines(doc, intro, PAGE.contentWidth, 9.2);
    text(doc, wrapped, PAGE.margin, y);
    y += wrapped.length * 4.15 + 4;
  }
  return y;
}

function paragraph(doc, y, value, { width = PAGE.contentWidth, size = 9.4, color = BRAND.ink, gap = 4.5 } = {}) {
  const wrapped = lines(doc, value, width, size);
  y = ensure(doc, y, wrapped.length * (size * 0.42) + gap + 2);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...color);
  doc.setFontSize(size);
  text(doc, wrapped, PAGE.margin, y);
  return y + wrapped.length * (size * 0.42) + gap;
}

function bullets(doc, y, items, { size = 9.1, bulletColor = BRAND.red, label = false } = {}) {
  for (const item of items) {
    const value = typeof item === "string" ? item : item.text;
    const title = typeof item === "string" ? "" : item.title;
    const wrapped = lines(doc, value, PAGE.contentWidth - 10, size);
    y = ensure(doc, y, wrapped.length * 4 + (title ? 10 : 5));
    doc.setFillColor(...bulletColor);
    doc.circle(PAGE.margin + 2, y - 1.2, label ? 1.5 : 1.1, "F");
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...BRAND.ink);
    doc.setFontSize(size);
    if (title) {
      doc.setFont("helvetica", "bold");
      text(doc, title, PAGE.margin + 7, y);
      doc.setFont("helvetica", "normal");
      text(doc, wrapped, PAGE.margin + 7, y + 4.2);
      y += 4.2;
    } else {
      text(doc, wrapped, PAGE.margin + 7, y);
    }
    y += wrapped.length * 4 + 2.5;
  }
  return y + 2;
}

function callout(doc, y, title, value, tone = "blue") {
  const colors = tone === "amber" ? { fill: [255, 248, 235], accent: BRAND.amber } : tone === "green" ? { fill: [240, 249, 244], accent: BRAND.green } : { fill: [241, 247, 254], accent: BRAND.blue };
  const wrapped = lines(doc, value, PAGE.contentWidth - 15, 8.9);
  const height = 11 + wrapped.length * 4;
  y = ensure(doc, y, height + 5);
  doc.setFillColor(...colors.fill);
  doc.roundedRect(PAGE.margin, y - 5, PAGE.contentWidth, height, 2, 2, "F");
  doc.setFillColor(...colors.accent);
  doc.roundedRect(PAGE.margin, y - 5, 3.5, height, 1.8, 1.8, "F");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...colors.accent);
  doc.setFontSize(8.2);
  text(doc, title.toUpperCase(), PAGE.margin + 8, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...BRAND.ink);
  doc.setFontSize(8.9);
  text(doc, wrapped, PAGE.margin + 8, y + 4.8);
  return y + height + 3;
}

function titlePage(doc, { label, title, subtitle, code, classification = "INTERNAL USE" }) {
  doc.setFillColor(...BRAND.red);
  doc.rect(0, 0, PAGE.width, 7, "F");
  doc.setFillColor(...BRAND.ink);
  doc.rect(0, 7, PAGE.width, 75, "F");
  doc.setDrawColor(238, 242, 247);
  doc.setLineWidth(0.35);
  for (let x = 118; x <= 194; x += 11) doc.line(x, 14, x - 45, 77);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  text(doc, "MEDTECH HR ERP", PAGE.margin, 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.setTextColor(210, 218, 229);
  text(doc, label.toUpperCase(), PAGE.margin, 29);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(255, 255, 255);
  const heading = lines(doc, title, 142, 24);
  text(doc, heading, PAGE.margin, 47);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(220, 225, 233);
  text(doc, lines(doc, subtitle, 150, 10), PAGE.margin, 64);

  doc.setFillColor(...BRAND.soft);
  doc.roundedRect(PAGE.margin, 100, PAGE.contentWidth, 43, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BRAND.red);
  doc.setFontSize(8);
  text(doc, classification, PAGE.margin + 8, 113);
  doc.setTextColor(...BRAND.ink);
  doc.setFontSize(12);
  text(doc, "Document control", PAGE.margin + 8, 124);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.3);
  doc.setTextColor(...BRAND.muted);
  text(doc, [
    `Reference: ${code}`,
    `Issued: ${DATE}`,
    "Source base: current application workspace and role catalogue",
    "Owner: HR Systems"
  ], PAGE.margin + 8, 132);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...BRAND.muted);
  doc.setFontSize(8.8);
  text(doc, "Designed as a working document: clear scope, accountable actions, and no implied access beyond the configured role.", PAGE.margin, 164, { maxWidth: PAGE.contentWidth });
}

function chrome(doc, title, code, classification) {
  const total = doc.getNumberOfPages();
  for (let page = 2; page <= total; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...BRAND.line);
    doc.setLineWidth(0.2);
    doc.line(PAGE.margin, 14, PAGE.width - PAGE.margin, 14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...BRAND.ink);
    doc.setFontSize(7.2);
    text(doc, "MEDTECH HR ERP", PAGE.margin, 10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...BRAND.muted);
    text(doc, title, PAGE.margin + 33, 10);
    text(doc, classification, PAGE.width - PAGE.margin, 10, { align: "right" });
    doc.setDrawColor(...BRAND.line);
    doc.line(PAGE.margin, 281, PAGE.width - PAGE.margin, 281);
    doc.setFontSize(7);
    doc.setTextColor(...BRAND.muted);
    text(doc, `${code}  |  Issued ${DATE}`, PAGE.margin, 286);
    text(doc, `Page ${page} of ${total}`, PAGE.width - PAGE.margin, 286, { align: "right" });
  }
  doc.setPage(1);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...BRAND.muted);
  text(doc, `${code}  |  Issued ${DATE}`, PAGE.margin, 282);
  text(doc, "MedTech HR ERP", PAGE.width - PAGE.margin, 282, { align: "right" });
}

function startDocument(meta) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: meta.title, subject: meta.subtitle, author: "MedTech HR ERP", creator: "MedTech HR ERP" });
  titlePage(doc, meta);
  return { doc, y: addPage(doc) };
}

function checklistTable(doc, y, rows, widths = [73, 34, 71]) {
  y = ensure(doc, y, 38);
  autoTable(doc, {
    startY: y,
    margin: { left: PAGE.margin, right: PAGE.margin },
    tableWidth: PAGE.contentWidth,
    theme: "plain",
    head: [["AREA", "WEIGHT", "ASSESSMENT"]],
    body: rows,
    styles: { font: "helvetica", fontSize: 8.2, cellPadding: 3, lineColor: BRAND.line, lineWidth: 0.15, textColor: BRAND.ink, valign: "top" },
    headStyles: { fillColor: BRAND.ink, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.2 },
    alternateRowStyles: { fillColor: BRAND.soft },
    columnStyles: { 0: { cellWidth: widths[0] }, 1: { cellWidth: widths[1], halign: "center" }, 2: { cellWidth: widths[2] } },
  });
  return (doc.lastAutoTable?.finalY ?? y) + 7;
}

function writeExecutiveBrief() {
  const meta = {
    label: "Leadership review",
    title: "Completion & readiness brief",
    subtitle: "A current, evidence-led view for the COO and CPO.",
    code: "MHR-LEAD-2026-08",
    classification: "COO & CPO REVIEW",
  };
  const { doc, y: firstY } = startDocument(meta);
  let y = firstY;
  y = section(doc, y, "01", "Decision snapshot", "The application has a broad, implemented HR scope. Its remaining gap is not feature ideation; it is the evidence needed to support a controlled production decision.");
  doc.setFillColor(...BRAND.ink);
  doc.roundedRect(PAGE.margin, y, 84, 35, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(26);
  text(doc, "84%", PAGE.margin + 8, y + 17);
  doc.setFontSize(9.5);
  text(doc, "FEATURE COMPLETION", PAGE.margin + 8, y + 25);
  doc.setFillColor(...BRAND.soft);
  doc.roundedRect(PAGE.margin + 92, y, 86, 35, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BRAND.red);
  doc.setFontSize(26);
  text(doc, "55%", PAGE.margin + 100, y + 17);
  doc.setFontSize(9.5);
  text(doc, "RELEASE EVIDENCE", PAGE.margin + 100, y + 25);
  y += 44;
  y = callout(doc, y, "Leadership position", "Treat the product as functionally advanced but not yet ready to declare production acceptance. The 84% figure measures built scope; 55% measures current, repeatable proof of safe operation.", "amber");
  y = bullets(doc, y, [
    { title: "What is implemented", text: "Core people data, attendance, leave approval, payroll, documents, recruitment, EOS, role-based access, audit history and executive reporting surfaces are present in the current application." },
    { title: "What passed today", text: "The frontend production build passed. Prisma generation, backend build and 24 backend security assertions passed." },
    { title: "What remains unproven", text: "Browser E2E, Docker Compose/runtime health, clean-database migrations and live deployment checks could not be run on this workstation." },
  ]);

  y = addPage(doc);
  y = section(doc, y, "02", "How the 84% was calculated", "A scope-weighted assessment was used so a large number of screens cannot hide gaps in workflow validation or operations. This is an appraisal of the current codebase, not a claim of regulatory certification.");
  y = checklistTable(doc, y, [
    ["Core people data & organisation", "16%", "16% — employee records, departments, positions and hierarchy are implemented."],
    ["Employee self-service", "12%", "12% — profile, attendance, leave, documents, certificates and notifications are available."],
    ["Attendance, leave & approvals", "18%", "15% — feature flow is implemented; end-to-end database/runtime acceptance remains open."],
    ["Payroll, loans & statutory outputs", "17%", "14% — server workflow, approvals, payslips and exports are implemented; live payroll validation remains open."],
    ["HR operations, documents & recruitment", "14%", "13% — recruitment, certificates, document library, malware status and EOS are implemented."],
    ["Role, security & access governance", "13%", "13% — eight built-in roles, scoped permissions, step-up controls and audit functions are implemented."],
    ["Operations & release engineering", "10%", "1% — deployment assets exist, but current runtime/deployment verification is unavailable."],
  ]);
  y = callout(doc, y, "Method note", "Completion credit is withheld where a capability is present in source but has not been demonstrated against the relevant execution environment. That avoids counting planned confidence as delivered confidence.", "blue");

  y = addPage(doc);
  y = section(doc, y, "03", "Evidence reviewed", "The assessment is grounded in the active workspace, including the current uncommitted application changes. It supersedes neither a formal security assessment nor a business-process acceptance test.");
  y = bullets(doc, y, [
    { title: "Role model", text: "Eight built-in roles are defined in the RBAC catalogue: Employee, Line Manager, Manager, HR, CPO, COO, Administrator and Super Administrator." },
    { title: "Route gating", text: "The frontend derives visible navigation from permissions, and restricts Payroll to HR, CPO, COO and Super Administrator roles." },
    { title: "Workflow coverage", text: "The codebase includes leave, service-request and payroll approval flows; publish/download paths; optimistic versions; idempotency headers; and protected override actions." },
    { title: "Security evidence", text: "The backend security regression suite passed 24 assertions, covering default-deny permissions, scoped denials, session/JWT controls, server-derived attendance and protected role constraints." },
    { title: "Known verification limits", text: "The default frontend test command also discovers a stale temporary deployment copy and attempts to load its Playwright suites under Vitest. The source test suites run, but the default command requires cleanup before it can be treated as a clean release gate." },
  ]);
  y = callout(doc, y, "Current machine constraint", "Playwright could not launch because its Chromium executable is not installed. Docker is not available in the current shell, so Compose validation, migrations and container health checks were not run.", "amber");

  y = addPage(doc);
  y = section(doc, y, "04", "Release evidence required", "These are validation gates, not feature requests. Closing them will turn the implementation into an accountable release candidate.");
  y = checklistTable(doc, y, [
    ["Browser workflow suite", "Open", "Install the approved Playwright browser and run all 15 mocked-API UI scenarios at desktop and mobile viewports."],
    ["Test-runner hygiene", "Open", "Exclude or relocate the stale tmp/deploy copy so `npm test` exercises only intended Vitest suites."],
    ["Clean database & migrations", "Open", "Apply migrations to a disposable PostgreSQL instance; exercise HR, employee, manager and executive workflows against it."],
    ["Docker & health", "Open", "Validate Compose configuration, build the existing stack, check frontend/API health endpoints and confirm one expected service set."],
    ["Business acceptance", "Open", "CPO nominates HR payroll and leave scenarios; COO confirms operational ownership, recovery and deployment decision criteria."],
    ["Deployment verification", "Open", "Deploy only through the existing medtech-hr-erp Compose project, then record health, backup and rollback evidence."],
  ], [62, 24, 92]);
  y = callout(doc, y, "Recommended decision", "Approve a short validation phase, not unrestricted production sign-off. The product is sufficiently complete to test with accountable HR and operations owners; production acceptance should wait for the stated evidence.", "green");

  y = addPage(doc);
  y = section(doc, y, "05", "Role coverage at a glance", "All role guides supplied with this brief describe the configured built-in role. A user may hold multiple roles; effective access is the union of assigned roles subject to any direct deny and scope constraints.");
  y = checklistTable(doc, y, [
    ["Employee", "Self-service", "Own profile, attendance, leave, documents, certificates, loans and notifications."],
    ["Line Manager", "Direct reports", "Employee access plus team visibility and first-stage leave/expense/trip actions."],
    ["Manager", "Management tree", "Employee access plus management-tree visibility and second-stage approvals."],
    ["Human Resources", "HR operations", "Employee administration, HR workflows, payroll, records, documents, recruitment and reports."],
    ["CPO / COO", "Executive", "Organisation-wide people, attendance, leave, payroll and recruitment insight; role-specific executive leave approval."],
    ["Administrator", "Platform oversight", "Global read/report/audit access and selected system oversight without routine business workflow mutation."],
    ["Super Administrator", "Controlled override", "All built-in capabilities plus protected access management and workflow overrides."],
  ], [51, 31, 96]);
  paragraph(doc, y + 2, "See the separate role guides for operational steps, guardrails and the deliberate limits attached to each role.", { color: BRAND.muted });
  chrome(doc, meta.title, meta.code, meta.classification);
  return save(doc, "MedTech-HR-ERP-Completion-and-Readiness-Brief.pdf");
}

const guides = [
  {
    code: "EMPLOYEE", title: "Employee guide", label: "Role guide", short: "Employee", purpose: "Use the HR ERP for your own employment information, attendance, leave, documents and HR certificates.",
    access: [
      { title: "Dashboard", text: "Review your current-day overview and notifications." },
      { title: "My HR", text: "Review the information linked to your employee record and your leave status." },
      { title: "Attendance", text: "Check in or out, review your own records and request a correction where it is needed." },
      { title: "Leave", text: "Review balances, request leave, upload required evidence, follow the timeline, correct a returned request or cancel an eligible request." },
      { title: "Documents", text: "Download documents and published payslips that have been made available to you; request salary, experience or clearance certificates." },
      { title: "Loans", text: "View your own loan details and repayment status." },
    ],
    flow: [
      "Open the relevant module from the left navigation; unavailable areas are deliberately hidden.",
      "For leave, choose the leave type and dates. Read the server-calculated paid, unpaid and available figures before selecting Submit request.",
      "Add an attachment whenever the request states that evidence is required. The application accepts one supported file up to the stated limit.",
      "Use Timeline to see the assigned approval stage. If a request is returned, use Correct and resubmit; do not create a duplicate request.",
      "For a certificate, open Documents, choose the certificate type and select Request. Download only after it is published.",
    ],
    guardrails: [
      "Your role is self-service only. HR maintains employment, payroll and organisation data; request a correction rather than attempting a workaround.",
      "A submitted request is not approved leave. Do not treat dates as confirmed until its status is approved.",
      "Keep your signed-in device secure and use the account menu to end access when you finish on a shared device.",
    ],
    limit: "You cannot see colleagues’ confidential records, approve your own requests, change payroll data or administer roles.",
  },
  {
    code: "LINE_MANAGER", title: "Line Manager guide", label: "Role guide", short: "Line Manager", purpose: "Manage direct-report information and complete first-stage approvals while retaining all employee self-service capabilities.",
    access: [
      { title: "Team", text: "Review people in your direct-report scope and use the approval inbox for items assigned to you." },
      { title: "Leave", text: "Read direct-report leave requests and approve, return or reject requests assigned to the Line Manager stage." },
      { title: "Attendance", text: "Review team attendance within your assigned scope." },
      { title: "Performance", text: "Manage performance information for direct reports where the workflow grants your role that task." },
      { title: "Expenses & trips", text: "Review team-level expense and business-trip requests where they are assigned to your stage." },
      { title: "Employee self-service", text: "Keep your own profile, attendance, leave, documents and certificates up to date using the Employee workflow." },
    ],
    flow: [
      "Open Team to identify items assigned to you; then open the relevant request from the workflow module.",
      "Read the request dates, balance context, attachments and timeline before making a decision.",
      "Select Approve only when the request meets operational requirements. Use Return or Reject when a reason or correction is needed.",
      "Enter a concise business reason whenever the form makes it required; it becomes part of the request history.",
      "Confirm that the status advances from your stage. If no item appears, it may be outside your reporting scope or assigned to another approver.",
    ],
    guardrails: [
      "Your scope is direct reports. A manager title does not grant access to another department or a peer’s staff.",
      "Approval is a decision, not a data-editing shortcut. Return a request for correction instead of changing another employee’s details.",
      "Do not approve a request if you are the requester or if the workflow presents a conflict; refer it to HR.",
    ],
    limit: "You do not administer payroll, employee compensation, roles, security settings or organisation-wide HR records.",
  },
  {
    code: "MANAGER", title: "Manager guide", label: "Role guide", short: "Manager", purpose: "Provide management-tree oversight and complete the configured second-stage approvals, alongside normal employee self-service access.",
    access: [
      { title: "Team", text: "Review employees in your management-tree scope and the approvals assigned to you." },
      { title: "Leave", text: "Review management-scope leave requests and act at the Manager approval stage." },
      { title: "Attendance", text: "Review attendance across your configured management scope." },
      { title: "Performance", text: "Manage performance workflows for eligible employees in your management scope." },
      { title: "Expenses & trips", text: "Review management-scope expense and business-trip requests when the workflow reaches your stage." },
      { title: "Employee self-service", text: "Use the same personal profile, attendance, leave, document and certificate services as an Employee." },
    ],
    flow: [
      "Start with Team or the relevant workflow module and filter attention to the items assigned to you.",
      "Open Timeline before deciding a leave request to confirm prior-stage action, dates and current routing.",
      "Approve, return or reject only the request that is explicitly assigned to your stage; record a reason where prompted.",
      "Use Team information for oversight, not to disclose confidential data outside a legitimate management need.",
      "Escalate policy exceptions, compensation questions and HR record changes to HR rather than altering a workflow to solve them.",
    ],
    guardrails: [
      "Management scope follows the configured reporting hierarchy. Access is not a blanket right to all people data.",
      "A workflow item can be visible without being actionable. The action buttons indicate the authority granted at its current stage.",
      "Keep decision reasons factual and job-related; request histories are auditable HR records.",
    ],
    limit: "You do not manage role assignments, run payroll, modify employee sensitive records or perform HR overrides.",
  },
  {
    code: "HR", title: "Human Resources guide", label: "Role guide", short: "Human Resources", purpose: "Operate the HR lifecycle: people records, attendance, leave, payroll, documents, certificates, recruitment, EOS and reports.",
    access: [
      { title: "Employees & settings", text: "Create and maintain employee records, sensitive HR details, departments, positions, leave policies and approved organisational settings." },
      { title: "Attendance & leave", text: "Manage attendance, leave balances and leave types; submit for an employee, manage requests and use authorised HR override paths." },
      { title: "Payroll", text: "Run preflight, generate payroll, record adjustments, submit/approve/publish, reconcile payments, export and download payslips." },
      { title: "Documents & certificates", text: "Manage HR documents, produce service-request documents, approve/publish/revoke certificates and control employee availability." },
      { title: "Recruitment & EOS", text: "Operate recruitment stages, manage candidate information and complete end-of-service activities." },
      { title: "Reports", text: "Review and export operational HR reports using approved data scopes." },
    ],
    flow: [
      "Maintain the employee and organisation records that workflows rely on before you operate payroll or approvals.",
      "For leave, use the server preview, check evidence and timeline, then select the appropriate approval, return, rejection or authorised override action.",
      "For payroll, run the preflight first. Resolve every blocking item, review warnings, generate, then use the separate submission, approval, publication and paid-reconciliation controls.",
      "Use a meaningful reason for corrections, overrides, payroll adjustments and other auditable actions. Do not use a generic note.",
      "Issue documents only after required checks are complete. Employees can download only clean, published documents made available to them.",
    ],
    guardrails: [
      "Payroll, employee bank details and sensitive HR data require deliberate handling. Export only for an approved business purpose and store files securely.",
      "Use the existing workflow action rather than editing a finalised result directly. The application preserves history and versioned workflow state.",
      "An HR override is an exception path. Record the reason, confirm authority and do not use it to bypass normal evidence collection.",
    ],
    limit: "HR does not administer protected roles or system-wide permission overrides. Escalate access-control changes to a Super Administrator under the approved process.",
  },
  {
    code: "CPO", title: "Chief People Officer guide", label: "Role guide", short: "Chief People Officer", purpose: "Provide executive people oversight, review organisation-wide HR information and decide requests routed to the CPO leave stage.",
    access: [
      { title: "People insight", text: "Review organisation-wide employee and attendance information for executive people oversight." },
      { title: "Leave", text: "Review organisation-wide leave context and approve, return or reject items explicitly assigned to the CPO stage." },
      { title: "Payroll", text: "Review payroll runs, compensation information, all payslips and permitted exports; download payroll documents as needed." },
      { title: "Recruitment", text: "Review recruitment information and pipeline progress." },
      { title: "Personal services", text: "Retain Employee access to your own profile, attendance, leave, documents, certificates, loans and notifications." },
    ],
    flow: [
      "Use the dashboard and executive-visible modules to review organisation conditions before acting on an approval.",
      "In Leave, open the request timeline and attachments, then confirm the requested decision is assigned to the CPO stage.",
      "Approve only after the applicable earlier workflow stages and business context are satisfactory. Return or reject with a clear reason where required.",
      "Use Payroll as an executive review and export surface. Routine payroll generation, correction and payment reconciliation remain HR functions.",
      "Refer individual employee record maintenance, leave configuration and document issuance to HR.",
    ],
    guardrails: [
      "Executive visibility does not remove confidentiality obligations. Access payroll and people data only for an approved leadership purpose.",
      "Your CPO approval authority applies only to requests routed to your assigned executive stage; it is not a blanket workflow override.",
      "Protect any exported payroll data as restricted HR information and avoid downloading it to unmanaged devices.",
    ],
    limit: "The CPO role is not an HR administration or platform-administration role. It does not create payroll runs, change policies, manage users or override workflows.",
  },
  {
    code: "COO", title: "Chief Operating Officer guide", label: "Role guide", short: "Chief Operating Officer", purpose: "Provide executive operational oversight, review organisation-wide people information and complete the configured final COO leave stage.",
    access: [
      { title: "Operational people insight", text: "Review organisation-wide employee and attendance information for operating decisions." },
      { title: "Leave", text: "Review organisation-wide requests and act at the COO stage, including the protected COO self-approval path when the workflow explicitly routes to it." },
      { title: "Payroll", text: "Review payroll runs, compensation information, all payslips and permitted exports; download payroll documents as needed." },
      { title: "Recruitment", text: "Review recruitment information and executive-level pipeline progress." },
      { title: "Personal services", text: "Retain Employee access to your own profile, attendance, leave, documents, certificates, loans and notifications." },
    ],
    flow: [
      "Review dashboard and operating context before making an executive decision.",
      "In Leave, verify the timeline, prior-stage outcomes, dates, attachments and business impact. Act only when the item is assigned to your stage.",
      "For COO self-approval, follow the protected confirmation prompt. Re-authenticate when asked; this is intentional control, not an error.",
      "Use Payroll for review and authorised reporting. Ask HR to resolve preflight exceptions, payroll corrections or payment reconciliation.",
      "Escalate data corrections, HR policy changes and access-control matters through the designated HR or Super Administrator process.",
    ],
    guardrails: [
      "The self-approval path is a tightly scoped exception, not a general right to approve every own request. Treat it as an auditable executive action.",
      "Executive insight remains restricted HR information. Do not redistribute exports or individual compensation data without a business and confidentiality basis.",
      "Return or reject a request when the record is incomplete; do not create off-system approval evidence.",
    ],
    limit: "The COO role does not administer users, roles, policies, payroll mutations or general workflow overrides.",
  },
  {
    code: "ADMIN", title: "Administrator guide", label: "Role guide", short: "Administrator", purpose: "Provide platform and assurance oversight with broad read, reporting and audit access, while keeping routine HR business decisions separate.",
    access: [
      { title: "Organisation insight", text: "Read organisation-wide employee, attendance, leave, service-request, expense, trip, loan, document, contract, performance, recruitment and EOS information." },
      { title: "Reports & audit", text: "Review authorised reports, export approved reporting outputs and access audit history." },
      { title: "Hierarchy & system", text: "Open the Hierarchy and System routes for permitted administration and oversight functions." },
      { title: "Workflow routing", text: "Reassign a leave step when the configured workflow and your authority require it." },
      { title: "Personal services", text: "Retain Employee self-service functions for your own profile, records and requests." },
    ],
    flow: [
      "Use Reports and Audit to investigate an approved operational question. Record the business context outside the system where the governance process requires it.",
      "Use Hierarchy to understand reporting relationships; it does not itself change a person’s login access.",
      "When a leave step cannot proceed because of approver availability, use the authorised reassignment path and document the reason.",
      "On System, use only panels and actions shown for your assigned permissions. The route may be visible while a specific control remains intentionally unavailable.",
      "Escalate requests to create users, assign protected roles or change permissions to a Super Administrator unless an additional explicit permission is assigned.",
    ],
    guardrails: [
      "Administrator access is deliberately read-heavy. Broad visibility is for assurance and operations, not a licence to alter HR business outcomes.",
      "Audit and report exports can contain sensitive data. Apply the same restricted handling expected for payroll and personnel information.",
      "Do not infer authority from a visible navigation item; the available controls and current permissions are authoritative.",
    ],
    limit: "The built-in Administrator role does not run payroll, alter payroll compensation, maintain HR master data, approve routine HR workflows or grant protected access by itself.",
  },
  {
    code: "SUPER_ADMIN", title: "Super Administrator guide", label: "Role guide", short: "Super Administrator", purpose: "Administer protected system access and handle approved workflow exceptions, while retaining the full operational capability inherited from all built-in roles.",
    access: [
      { title: "All operational modules", text: "Access the capabilities inherited from Employee, Line Manager, Manager, HR, CPO, COO and Administrator roles." },
      { title: "System access", text: "Create or maintain login users, assign roles, manage permitted direct overrides, review active sessions and manage custom roles where controls allow." },
      { title: "Protected access", text: "Assign protected roles and permissions through the controlled step-up and reason-capture process." },
      { title: "Workflow exceptions", text: "Use protected leave, service-request and payroll override paths only when an authorised exception exists." },
      { title: "Audit", text: "Review audit evidence and export it where authorised for investigations or governance." },
    ],
    flow: [
      "Start with the minimum access change that resolves the approved business need. Prefer a standard role over a direct permission override.",
      "For user or role changes, select the complete intended role set, provide a meaningful reason and complete step-up authentication if prompted.",
      "Confirm the affected user’s access version/session outcome after the change. Existing sessions may be revoked to enforce new access safely.",
      "Use workflow overrides only after checking the normal route, attachments and history. Record the factual exception reason and target state.",
      "Review audit history after sensitive changes and protect exports as restricted records.",
    ],
    guardrails: [
      "Super Administrator is a break-glass operational role, not a convenience role. Use it sparingly and under an approved access-management procedure.",
      "Never share credentials, turn off a control to bypass a workflow, or use a direct permission grant where a documented role would suffice.",
      "A protected action requires stronger evidence: a business reason, recent authentication and an auditable record. Preserve all three.",
    ],
    limit: "Full application access does not remove legal, HR policy, segregation-of-duties or confidentiality obligations. External approvals may still be required.",
  },
];

function writeRoleGuide(guide) {
  const meta = {
    label: "Role guide",
    title: guide.title,
    subtitle: guide.purpose,
    code: `MHR-ROLE-${guide.code}-2026-08`,
    classification: "INTERNAL USE",
  };
  const { doc, y: firstY } = startDocument(meta);
  let y = firstY;
  y = section(doc, y, "01", "Your role in the application", guide.purpose);
  y = callout(doc, y, "Access principle", "The navigation and action buttons shown to you are driven by your assigned permissions and scope. A page that is absent or an action that is disabled is a deliberate access boundary.", "blue");
  y = section(doc, y, "02", "What you can use", "This guide lists the practical areas intended for this built-in role. Access can be narrower when a direct deny or resource scope applies.");
  y = bullets(doc, y, guide.access, { label: true });

  y = addPage(doc);
  y = section(doc, y, "03", "Working playbook", "Use this sequence for your ordinary work. The exact action available depends on the current workflow stage and the record’s scope.");
  guide.flow.forEach((item, index) => {
    y = ensure(doc, y, 17);
    doc.setFillColor(...BRAND.soft);
    doc.roundedRect(PAGE.margin, y - 5.3, 8, 8, 1.8, 1.8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.4);
    doc.setTextColor(...BRAND.red);
    text(doc, String(index + 1).padStart(2, "0"), PAGE.margin + 4, y, { align: "center" });
    const wrapped = lines(doc, item, PAGE.contentWidth - 14, 9.4);
    doc.setTextColor(...BRAND.ink);
    doc.setFont("helvetica", "normal");
    text(doc, wrapped, PAGE.margin + 13, y);
    y += wrapped.length * 4.15 + 5.5;
  });
  y = callout(doc, y, "Records and reasons", "Where the application asks for a reason, enter a concise, factual explanation. Workflow history and access changes are part of the HR record and may be audited.", "green");

  y = addPage(doc);
  y = section(doc, y, "04", "Boundaries that protect people and data", "Use only the minimum access needed to perform the assigned duty. The role model keeps business decisions, access administration and sensitive data handling separate.");
  y = bullets(doc, y, guide.guardrails, { bulletColor: BRAND.amber });
  y = callout(doc, y, "Deliberate limit", guide.limit, "amber");
  y = section(doc, y, "05", "Everyday controls", "These controls apply to every role, including executive and administrative accounts.");
  y = bullets(doc, y, [
    { title: "Use your own account", text: "Do not share passwords, sessions, downloaded documents or approval responsibility." },
    { title: "Check scope", text: "Confirm the employee, department, date and workflow stage before you submit a decision or export data." },
    { title: "Handle exports carefully", text: "Payroll, personnel, audit and document downloads may contain restricted data. Store and transmit them only through approved business channels." },
    { title: "Raise exceptions", text: "If the required action is not available, do not work around the control. Escalate it to HR or the designated Super Administrator." },
  ]);
  paragraph(doc, y + 4, "For support, provide the record reference, the exact action attempted, the on-screen message and the role you are using. Do not include passwords or full sensitive document contents in a support request.", { color: BRAND.muted });
  chrome(doc, meta.title, meta.code, meta.classification);
  return save(doc, `MedTech-HR-ERP-${guide.code.replaceAll("_", "-")}-User-Guide.pdf`);
}

function save(doc, filename) {
  const target = path.join(OUTPUT_DIR, filename);
  const data = Buffer.from(doc.output("arraybuffer"));
  if (data.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error(`${filename} was not written as a PDF.`);
  writeFileSync(target, data);
  const size = statSync(target).size;
  if (size < 5_000) throw new Error(`${filename} is unexpectedly small.`);
  return { filename, size, pages: doc.getNumberOfPages() };
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const files = [writeExecutiveBrief(), ...guides.map(writeRoleGuide)];
if (files.length !== 9 || files.some(file => file.pages < 3 || file.size < 5_000)) throw new Error("PDF generation validation failed.");
console.table(files);

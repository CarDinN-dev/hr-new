import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { navPaths } from "../src/routing";

const evidenceDir = resolve("ui-evidence");
const sessionKey = "medtech-hr-erp-backend-session-v2";

const employees = [
  {
    id: "employee-1", employeeCode: "MTC001", firstName: "Mohammed", lastName: "Kashif",
    email: "mohammed.kashif@med-tech.com", phone: "+974 5000 1001", hireDate: "2024-01-08", employmentStatus: "ACTIVE",
    department: { id: "dept-hr", name: "Human Resources", code: "HR" }, position: { title: "HR Manager", code: "HR-MGR" },
  },
  {
    id: "employee-2", employeeCode: "MTC014", firstName: "Aisha", lastName: "Rahman",
    email: "aisha.rahman@med-tech.com", phone: "+974 5000 1014", hireDate: "2023-04-16", employmentStatus: "ACTIVE",
    department: { id: "dept-sales", name: "Sales", code: "SAL" }, position: { title: "Sales Coordinator", code: "SAL-COORD" },
  },
  {
    id: "employee-3", employeeCode: "MTC027", firstName: "Omar", lastName: "Farooq",
    email: "omar.farooq@med-tech.com", phone: "+974 5000 1027", hireDate: "2022-09-04", employmentStatus: "ACTIVE",
    department: { id: "dept-service", name: "Service", code: "SRV" }, position: { title: "Service Engineer", code: "SRV-ENG" },
  },
  {
    id: "employee-4", employeeCode: "MTC031", firstName: "Sara", lastName: "Ahmed",
    email: "sara.ahmed@med-tech.com", phone: "+974 5000 1031", hireDate: "2025-02-02", employmentStatus: "ON_PROBATION",
    department: { id: "dept-finance", name: "Finance", code: "FIN" }, position: { title: "Accountant", code: "FIN-ACC" },
  },
  {
    id: "employee-5", employeeCode: "MTC042", firstName: "Hassan", lastName: "Ali",
    email: "hassan.ali@med-tech.com", phone: "+974 5000 1042", hireDate: "2021-11-21", employmentStatus: "ACTIVE",
    department: { id: "dept-logistics", name: "Logistics", code: "LOG" }, position: { title: "Operations Manager", code: "LOG-OM" },
  },
];

const departments = [
  { id: "dept-hr", name: "Human Resources", code: "HR" },
  { id: "dept-sales", name: "Sales", code: "SAL" },
  { id: "dept-service", name: "Service", code: "SRV" },
  { id: "dept-finance", name: "Finance", code: "FIN" },
  { id: "dept-logistics", name: "Logistics", code: "LOG" },
];

const session = {
  id: "evidence-admin",
  email: "mohammed.kashif@med-tech.com",
  displayName: "Mohammed Kashif",
  csrfToken: "evidence-csrf",
  roles: ["SUPER_ADMIN", "HR"],
  departmentScopeIds: [],
  sessionId: "evidence-session",
  authProvider: "local",
  authorizationVersion: 1,
  employeeId: "employee-1",
  permissions: [
    "session.self.read", "session.self.revoke", "session.manage",
    "employee.self.read", "employee.team.read", "employee.management.read", "employee.hr.read", "employee.read_all", "employee.hr.create", "employee.hr.update", "employee.hr.read_sensitive",
    "department.read", "department.manage", "position.manage", "organization.read", "settings.read", "settings.manage",
    "attendance.hr.read", "attendance.hr.manage", "attendance.audit.read", "attendance.read_all",
    "leave.self.read", "leave.self.create", "leave.team.read", "leave.management.read", "leave.hr.read", "leave.hr.approve", "leave.audit.read", "leave.read_all", "leave.configure",
    "trip.self.read", "trip.team.read", "trip.management.read", "trip.hr.read", "trip.read_all",
    "expense.self.read", "expense.team.read", "expense.management.read", "expense.hr.read", "expense.read_all",
    "loan.self.read", "loan.hr.read", "loan.hr.manage", "loan.audit.read", "loan.read_all",
    "payroll.self.read_payslip", "payroll.read", "payroll.audit.read", "payroll.generate", "payroll.approve", "payroll.payslip.read_all", "payroll.read_compensation", "payroll.configure", "payroll.export",
    "recruitment.read", "eos.read", "document.self.read", "document.hr.read", "document.read_all", "report.read", "report.export", "audit.read", "audit.export",
    "service_request.self.read", "service_request.self.create", "service_request.hr.approve", "service_request.hr.reject",
    "role.read", "role.manage", "permission.read", "permission.assign", "role.assign", "user.read", "user.manage",
    "workflow.policy.read", "workflow.policy.manage", "workflow.delegation.read", "workflow.delegation.manage", "notification.read",
  ],
};

function envelope(data: unknown, total = Array.isArray(data) ? data.length : 0) {
  return JSON.stringify({ success: true, data, meta: { total, page: 1, limit: 100, totalPages: total > 0 ? 1 : 0, unread: 2 } });
}

async function installEvidenceApi(page: Page, signedIn: () => boolean) {
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === "/api/v1/auth/me") {
      if (!signedIn()) {
        await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false, message: "Unauthorized" }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: envelope({ csrfToken: session.csrfToken, user: session }) });
      return;
    }

    const attendance = employees.map((employee, index) => ({
      id: `attendance-${index + 1}`,
      employeeId: employee.id,
      attendanceDate: "2026-08-25",
      status: index === 2 ? "LATE" : "PRESENT",
      checkInAt: index === 2 ? "2026-08-25T05:22:00.000Z" : "2026-08-25T05:00:00.000Z",
      checkOutAt: "2026-08-25T14:00:00.000Z",
      lateMinutes: index === 2 ? 22 : 0,
      employee,
    }));

    const payrollRuns = [{
      id: "payroll-2026-08", year: 2026, month: 8, runType: "REGULAR", status: "PUBLISHED",
      employeeCount: employees.length, grossPay: "127500.00", deductions: "8450.00", netPay: "119050.00",
      generatedAt: "2026-08-24T08:00:00.000Z", publishedAt: "2026-08-25T08:00:00.000Z",
    }];

    const data = pathname === "/api/v1/employees/me" ? employees[0]
      : pathname === "/api/v1/employees" ? employees
      : pathname === "/api/v1/departments" ? departments
      : pathname === "/api/v1/organization-settings" ? {
        name: "MedTech", legalName: "MedTech Corporation Trading W.L.L.", tagline: "Technology Advancing Healthcare",
        address: "Doha, Qatar", phone: "+974 4000 0000", email: "hr@med-tech.com", website: "www.med-tech.com", currency: "QAR",
      }
      : pathname === "/api/v1/attendance" ? attendance
      : pathname === "/api/v1/attendance/reports/summary" ? {
        summary: { totalRecords: employees.length, byStatus: { PRESENT: 4, LATE: 1, ABSENT: 0, LEAVE: 0 } },
      }
      : pathname === "/api/v1/leave/types" ? [
        { id: "annual", name: "Annual Leave", code: "ANNUAL", daysPerYear: 30 },
        { id: "sick", name: "Sick Leave", code: "SICK", daysPerYear: 14 },
      ]
      : pathname === "/api/v1/approvals/inbox" ? {
        leave: [{
          id: "leave-approval-1", employee: employees[1], leaveType: { name: "Annual Leave" }, currentStage: "HR",
          startDate: "2026-09-03", endDate: "2026-09-05", totalDays: "3", version: 1,
        }],
        certificates: [], payroll: [],
      }
      : pathname === "/api/v1/payroll/runs" ? payrollRuns
      : pathname === "/api/v1/payroll/preflight" ? {
        ready: true, runType: "REGULAR",
        policy: { prorationBasis: "FIXED_30", requireBankDetails: true, requireAttendance: true, varianceThreshold: "10" },
        summary: { employees: employees.length, errors: 0, warnings: 0, grossPay: "127500.00", deductions: "8450.00", netPay: "119050.00", adjustments: 0 },
        issues: [],
      }
      : pathname === "/api/v1/payroll/payslips" ? employees.map((employee, index) => ({
        id: `payslip-${index + 1}`, employeeId: employee.id, year: 2026, month: 8,
        baseSalary: `${18000 + index * 1500}.00`, allowances: "3500.00", deductions: `${900 + index * 75}.00`,
        bonuses: "0.00", grossPay: `${21500 + index * 1500}.00`, netPay: `${20600 + index * 1425}.00`, status: "PUBLISHED", employee,
      }))
      : pathname === "/api/v1/notifications" ? [
        { id: "notification-1", type: "LEAVE", title: "Leave request awaiting review", message: "Aisha Rahman submitted an annual leave request.", createdAt: "2026-08-25T07:30:00.000Z", readAt: null },
        { id: "notification-2", type: "PAYROLL", title: "Payroll published", message: "August 2026 payroll is available.", createdAt: "2026-08-25T08:05:00.000Z", readAt: null },
      ]
      : pathname === "/api/v1/search/sections" ? []
      : [];

    await route.fulfill({ status: 200, contentType: "application/json", body: envelope(data) });
  });
}

test("capture the verified MedTech product experience", async ({ page }) => {
  test.setTimeout(90_000);
  rmSync(evidenceDir, { recursive: true, force: true });
  mkdirSync(evidenceDir, { recursive: true });

  let authenticated = false;
  await installEvidenceApi(page, () => authenticated);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });

  await page.goto(navPaths.Dashboard);
  await expect(page.locator(".login-card")).toBeVisible();
  await expect(page.locator(".login-brand img")).toHaveAttribute("src", "/logos/medtech-lockup.svg?v=4");
  await page.screenshot({ path: resolve(evidenceDir, "01-login-desktop.png"), fullPage: true });

  authenticated = true;
  await page.context().addInitScript(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), { key: sessionKey, value: session });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });

  for (const [filename, route] of [
    ["02-hr-dashboard-desktop.png", navPaths.Dashboard],
    ["03-employees-desktop.png", navPaths.Employees],
    ["04-attendance-desktop.png", navPaths.Attendance],
    ["05-payroll-desktop.png", navPaths.Payroll],
  ] as const) {
    await page.goto(route);
    await expect(page.locator(".content")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: resolve(evidenceDir, filename), fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(navPaths.Dashboard);
  await expect(page.locator(".content")).toBeVisible();
  await page.screenshot({ path: resolve(evidenceDir, "06-hr-dashboard-mobile.png"), fullPage: true });

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

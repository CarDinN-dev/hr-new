import { expect, test, type Page } from "@playwright/test";
import { navPaths } from "../src/routing";

const session = {
  id: "search-admin", email: "search.admin@example.invalid", displayName: "Search Admin", csrfToken: "csrf-token",
  roles: ["SUPER_ADMIN"], departmentScopeIds: [], sessionId: "search-session", authProvider: "local", authorizationVersion: 1,
  employeeId: "employee-1",
  permissions: [
    "session.self.read", "session.self.revoke", "session.manage", "employee.self.read", "employee.team.read", "employee.management.read", "employee.hr.read", "employee.read_all", "employee.hr.create",
    "department.read", "department.manage", "organization.read", "settings.read", "settings.manage", "system.configure", "position.manage",
    "attendance.self.read", "attendance.team.read", "attendance.management.read", "attendance.hr.read", "attendance.audit.read", "attendance.read_all",
    "leave.self.read", "leave.team.read", "leave.management.read", "leave.hr.read", "leave.audit.read", "leave.read_all", "leave.configure",
    "loan.self.read", "loan.hr.read", "loan.audit.read", "loan.read_all", "payroll.self.read_payslip", "payroll.read", "payroll.audit.read", "payroll.generate", "payroll.payslip.read_all", "payroll.export",
    "recruitment.read", "eos.read", "document.self.read", "document.hr.read", "document.read_all", "report.read", "audit.read", "service_request.self.read",
    "role.read", "role.manage", "permission.read", "permission.assign", "role.assign", "user.read", "user.manage",
    "workflow.policy.read", "workflow.policy.manage", "workflow.delegation.read", "workflow.delegation.manage", "notification.read"
  ]
};

const employees = [
  { id: "employee-1", employeeCode: "MTC001", firstName: "Alice", lastName: "Smith", email: "alice@example.invalid", phone: "+974 5555 0001", hireDate: "2025-01-10", employmentStatus: "ACTIVE", department: { id: "dept-finance", code: "FIN", name: "Finance" }, position: { code: "MGR", title: "Manager" } },
  { id: "employee-2", employeeCode: "MTC002", firstName: "Bob", lastName: "Jones", email: "bob@example.invalid", phone: "+974 5555 0002", hireDate: "2025-02-10", employmentStatus: "ACTIVE", department: { id: "dept-tech", code: "TECH", name: "Technology" }, position: { code: "ENG", title: "Engineer" } },
];

async function installApi(page: Page) {
  await page.addInitScript(value => sessionStorage.setItem("medtech-hr-erp-backend-session-v2", JSON.stringify(value)), session);
  await page.route("**/api/v1/**", route => {
    const url = new URL(route.request().url());
    const data = url.pathname === "/api/v1/search/sections" ? { data: [] }
      : url.pathname === "/api/v1/approvals/inbox" ? { leave: [], certificates: [], payroll: [] }
      : url.pathname === "/api/v1/payroll/preflight" ? { ready: true, runType: "REGULAR", policy: { prorationBasis: "FIXED_30", requireBankDetails: true, requireAttendance: false, varianceThreshold: "10" }, summary: { employees: 0, errors: 0, warnings: 0, grossPay: "0", deductions: "0", netPay: "0", adjustments: 0 }, issues: [] }
      : url.pathname === "/api/v1/employees" ? (url.searchParams.get("search") ? employees.slice(0, 1) : employees)
      : [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data, meta: { total: 0, page: 1, limit: 100, totalPages: 1 } }) });
  });
}

test("every sidebar page exposes one page-specific search control", async ({ page }) => {
  await installApi(page);
  for (const [name, path] of Object.entries(navPaths)) {
    await test.step(name, async () => {
      await page.goto(path);
      await expect(page.getByRole("search")).toHaveCount(1);
      const input = page.getByRole("searchbox");
      await expect(input).toBeVisible();
      await expect(input).toHaveAttribute("aria-label", /Search/i);
      await expect(input).toHaveAttribute("maxlength", "100");
    });
  }
});

test("search is debounced, mapped to the page endpoint, clearable and reset by navigation", async ({ page }) => {
  await installApi(page);
  await page.goto(navPaths.Employees);
  const input = page.getByRole("searchbox");
  const request = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === "/api/v1/employees" && url.searchParams.get("search") === "Alice";
  });
  await input.fill("Alice");
  await request;
  await expect(page.locator(".page-search-status")).toContainText(/result/i);
  await expect(page.getByRole("button", { name: /Alice Smith/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Bob Jones/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search employees" }).click();
  await expect(input).toHaveValue("");
  await input.fill("Finance");
  await page.goto(navPaths.Attendance);
  await expect(page.getByRole("searchbox")).toHaveValue("");
});

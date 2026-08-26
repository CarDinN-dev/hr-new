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
    "leave.self.read", "leave.team.read", "leave.management.read", "leave.hr.read", "leave.audit.read", "leave.read_all", "leave.configure", "trip.read_all", "expense.read_all",
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

type ApiOptions = {
  searchedEmployees?: Array<(typeof employees)[number]>;
  attendance?: Array<Record<string, unknown>>;
  searchedAttendance?: Array<Record<string, unknown>>;
  approvals?: { leave: unknown[]; certificates: unknown[]; payroll: unknown[] };
  searchedApprovals?: { leave: unknown[]; certificates: unknown[]; payroll: unknown[] };
  holdEmployeeSearch?: boolean;
  holdApprovalSearch?: boolean;
};

async function installApi(page: Page, options: ApiOptions = {}) {
  let releaseEmployeeSearch = () => {};
  let releaseApprovalSearch = () => {};
  const employeeSearchGate = new Promise<void>(resolve => { releaseEmployeeSearch = resolve; });
  const approvalSearchGate = new Promise<void>(resolve => { releaseApprovalSearch = resolve; });
  await page.addInitScript(value => sessionStorage.setItem("medtech-hr-erp-backend-session-v2", JSON.stringify(value)), session);
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/employees" && url.searchParams.get("search") && options.holdEmployeeSearch) await employeeSearchGate;
    if (url.pathname === "/api/v1/approvals/inbox" && url.searchParams.get("search") && options.holdApprovalSearch) await approvalSearchGate;
    const data = url.pathname === "/api/v1/search/sections" ? { data: [] }
      : url.pathname === "/api/v1/approvals/inbox" ? (url.searchParams.get("search") ? options.searchedApprovals : options.approvals) ?? { leave: [], certificates: [], payroll: [] }
      : url.pathname === "/api/v1/attendance/reports/summary" ? { summary: { totalRecords: 0, byStatus: { PRESENT: 0, LATE: 0, ABSENT: 0 } } }
      : url.pathname === "/api/v1/payroll/preflight" ? { ready: true, runType: "REGULAR", policy: { prorationBasis: "FIXED_30", requireBankDetails: true, requireAttendance: false, varianceThreshold: "10" }, summary: { employees: 0, errors: 0, warnings: 0, grossPay: "0", deductions: "0", netPay: "0", adjustments: 0 }, issues: [] }
      : url.pathname === "/api/v1/employees" ? (url.searchParams.get("search") ? options.searchedEmployees ?? employees.slice(0, 1) : employees)
      : url.pathname === "/api/v1/attendance" ? (url.searchParams.get("search") ? options.searchedAttendance ?? [] : options.attendance ?? [])
      : [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data, meta: { total: 0, page: 1, limit: 100, totalPages: 1 } }) });
  });
  return { releaseEmployeeSearch, releaseApprovalSearch };
}

test("every sidebar page exposes one page-specific search control", async ({ page }) => {
  await installApi(page);
  for (const [name, path] of Object.entries(navPaths)) {
    await test.step(name, async () => {
      await page.goto(path);
      await expect(page.getByRole("search")).toHaveCount(1);
      const input = page.getByRole("searchbox");
      await expect(input).toBeVisible();
      if (name === "Employees") {
        await expect(page.locator(".employee-filters").getByRole("search")).toHaveCount(1);
        await expect(page.locator(".topbar").getByRole("search")).toHaveCount(0);
      }
      await expect(input).toHaveAttribute("aria-label", /Search/i);
      await expect(input).toHaveAttribute("maxlength", "100");
      await input.focus();
      await expect(input).toHaveCSS("outline-style", "none");
      const [inputBox, iconBox] = await Promise.all([input.boundingBox(), page.locator(".page-search > svg").boundingBox()]);
      expect(inputBox!.x).toBeGreaterThan(iconBox!.x + iconBox!.width);
    });
  }
});

test("employee directory search is debounced, partial, clearable and reset by navigation", async ({ page }) => {
  await installApi(page);
  await page.goto(navPaths.Employees);
  const input = page.getByRole("searchbox");
  await input.fill("li");
  await expect(page.locator(".page-search-status")).toContainText(/result/i);
  await expect(page.getByRole("button", { name: /Alice Smith/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Bob Jones/ })).toHaveCount(0);
  await input.fill("tc002");
  await expect(page.getByRole("button", { name: /Alice Smith/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Bob Jones/ })).toBeVisible();
  await input.fill("alice@example.invalid");
  await expect(page.locator(".employee-card-main")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search employees" }).click();
  await expect(input).toHaveValue("");
  await input.fill("MTC001");
  await page.goto(navPaths.Attendance);
  await expect(page.getByRole("searchbox")).toHaveValue("");
});

test("Team keeps its full-scope metric while filtering people", async ({ page }) => {
  const api = await installApi(page, {
    searchedEmployees: [employees[0]],
    approvals: { leave: [], certificates: [{ id: "certificate-1", requestType: "EMPLOYMENT_LETTER", status: "PENDING", version: 1, subject: { firstName: "Alice", lastName: "Smith" } }], payroll: [] },
    searchedApprovals: { leave: [], certificates: [], payroll: [] },
    holdApprovalSearch: true,
  });
  await page.goto(navPaths.Team);
  await expect(page.getByText(/Certificate.*Employment Letter/)).toBeVisible();
  const searched = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === "/api/v1/employees" && url.searchParams.get("search") === "Alice";
  });
  await page.getByRole("searchbox").fill("Alice");
  await searched;
  const metric = page.locator(".metric").filter({ hasText: "PEOPLE IN SCOPE" });
  await expect(metric.locator("strong")).toHaveText("2");
  const table = page.getByRole("region", { name: "People in scope" });
  await expect(table).toContainText("Alice Smith");
  await expect(table).not.toContainText("Bob Jones");
  await expect(page.getByText(/Certificate.*Employment Letter/)).toBeVisible();
  api.releaseApprovalSearch();
  await expect(page.getByText("No approvals waiting.")).toBeVisible();
});

test("Attendance combines marked attendance and unmarked employee identity matches with existing filters", async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  const bobAttendance = { id: "attendance-1", employeeId: "employee-2", attendanceDate: `${today}T00:00:00.000Z`, status: "PRESENT", approvalStatus: "APPROVED" };
  await installApi(page, { searchedEmployees: [employees[0]], attendance: [bobAttendance], searchedAttendance: [bobAttendance] });
  await page.goto(navPaths.Attendance);
  const attendanceRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === "/api/v1/attendance" && url.searchParams.get("search") === "employee";
  });
  const employeeRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === "/api/v1/employees" && url.searchParams.get("search") === "employee";
  });
  await page.getByRole("searchbox").fill("employee");
  await Promise.all([attendanceRequest, employeeRequest]);
  const board = page.locator(".attendance-board");
  await expect(board).toContainText("Alice Smith");
  await expect(board).toContainText("Bob Jones");
  await page.getByLabel("Status filter").selectOption("Unmarked");
  await expect(board).toContainText("Alice Smith");
  await expect(board).not.toContainText("Bob Jones");
  await page.getByLabel("Status filter").selectOption("Present");
  await expect(board).toContainText("Bob Jones");
  await expect(board).not.toContainText("Alice Smith");
  await page.getByLabel("Department filter").selectOption("Technology");
  await expect(board).toContainText("Bob Jones");
  const next = new Date(`${today}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);
  const dateSearch = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === "/api/v1/attendance" && url.searchParams.get("search") === "employee" && url.searchParams.get("dateFrom") === nextDate;
  });
  await page.getByLabel("Attendance date").fill(nextDate);
  await dateSearch;
});

test("employee directory filters remain available and combine with directory search", async ({ page }) => {
  await installApi(page);
  await page.goto(navPaths.Employees);
  await expect(page.locator(".employee-filters").getByRole("searchbox")).toBeVisible();
  await expect(page.locator(".topbar").getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByLabel("Filter employees by department")).toBeVisible();
  await expect(page.getByLabel("Filter employees by status")).toBeVisible();
  await page.getByLabel("Filter employees by department").click();
  const [departmentTrigger, departmentOptions] = await Promise.all([
    page.getByLabel("Filter employees by department").boundingBox(),
    page.locator(".department-filter__options").boundingBox(),
  ]);
  expect(departmentTrigger).not.toBeNull();
  expect(departmentOptions).not.toBeNull();
  expect(departmentOptions!.y).toBeGreaterThanOrEqual(departmentTrigger!.y + departmentTrigger!.height);
  expect(departmentOptions!.y + departmentOptions!.height).toBeLessThanOrEqual(900);
  await page.locator(".department-filter__options").evaluate(menu => menu.dispatchEvent(new Event("scroll")));
  await expect(page.locator(".department-filter__options")).toBeVisible();
  await page.getByRole("option", { name: "Finance" }).click();
  await page.getByRole("searchbox").fill("Alice Smith");
  await expect(page.getByRole("button", { name: /Alice Smith/ })).toBeVisible();
  await page.getByLabel("Filter employees by status").selectOption("On Leave");
  await expect(page.getByRole("button", { name: /Alice Smith/ })).toHaveCount(0);

  await page.goto(navPaths.Attendance);
  await expect(page.getByLabel("Attendance date")).toBeVisible();
  await expect(page.getByLabel("Department filter")).toBeVisible();
  await expect(page.getByLabel("Status filter")).toBeVisible();

  await page.goto(navPaths.Loans);
  await expect(page.getByLabel("Loan status filter")).toBeVisible();
  await expect(page.getByLabel("Loan department filter")).toBeVisible();

  await page.goto(navPaths.Audit);
  await expect(page.getByLabel("Outcome")).toBeVisible();
  await expect(page.getByLabel("Action")).toBeVisible();
  await expect(page.getByLabel("Resource type")).toBeVisible();
  await expect(page.getByLabel("From")).toBeVisible();
  await expect(page.getByLabel("To", { exact: true })).toBeVisible();
});

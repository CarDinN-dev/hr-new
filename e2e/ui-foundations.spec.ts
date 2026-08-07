import { expect, test, type Page } from "@playwright/test";
import { navPaths } from "../src/routing";

const session = {
  id: "ui-admin", email: "ui.admin@example.invalid", displayName: "UI Admin", csrfToken: "csrf-token",
  roles: ["SUPER_ADMIN"], departmentScopeIds: [], sessionId: "ui-session", authProvider: "local", authorizationVersion: 1,
  employeeId: "employee-1",
  permissions: [
    "session.self.read", "session.self.revoke", "employee.self.read", "employee.team.read", "employee.management.read", "employee.hr.read", "employee.read_all", "employee.hr.create",
    "department.read", "department.manage", "organization.read", "settings.read", "settings.manage", "position.manage",
    "attendance.self.read", "attendance.team.read", "attendance.management.read", "attendance.hr.read", "attendance.audit.read", "attendance.read_all",
    "leave.self.read", "leave.team.read", "leave.management.read", "leave.hr.read", "leave.audit.read", "leave.read_all", "leave.configure",
    "trip.self.read", "trip.team.read", "trip.management.read", "trip.hr.read", "trip.read_all",
    "expense.self.read", "expense.team.read", "expense.management.read", "expense.hr.read", "expense.read_all",
    "loan.self.read", "loan.hr.read", "loan.audit.read", "loan.read_all",
    "payroll.self.read_payslip", "payroll.read", "payroll.audit.read", "payroll.generate", "payroll.payslip.read_all", "payroll.export",
    "recruitment.read", "eos.read", "document.self.read", "document.hr.read", "document.read_all", "report.read", "audit.read",
    "service_request.self.read", "role.read", "role.manage", "permission.read", "permission.assign", "role.assign", "user.read", "user.manage",
    "session.manage", "workflow.policy.read", "workflow.policy.manage", "workflow.delegation.read", "workflow.delegation.manage", "notification.read"
  ]
};

async function installUiApi(page: Page, employees: unknown[] = [], extraPermissions: string[] = []) {
  await page.addInitScript(({ value, permissions }) => sessionStorage.setItem("medtech-hr-erp-backend-session-v2", JSON.stringify({ ...value, permissions: [...value.permissions, ...permissions] })), { value: session, permissions: extraPermissions });
  await page.route("**/api/v1/**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data: new URL(route.request().url()).pathname === "/api/v1/employees" ? employees : [], meta: { total: 0, page: 1, limit: 100, totalPages: 1 } })
  }));
}

const workforceEmployees = [
  {
    id: "employee-1", employeeCode: "EMP-001", firstName: "Noor", lastName: "Employee", email: "noor@example.invalid",
    hireDate: "2024-01-01", employmentStatus: "ACTIVE", salary: "5000", salaryRecords: [{ baseSalary: "5000" }],
    department: { id: "department-1", name: "Service", code: "SERVICE" }, position: { title: "Service Engineer", code: "ENGINEER" },
  },
  {
    id: "employee-2", employeeCode: "EMP-002", firstName: "Sam", lastName: "Colleague", email: "sam@example.invalid",
    hireDate: "2025-01-01", employmentStatus: "ON_LEAVE",
    department: { id: "department-1", name: "Service", code: "SERVICE" }, position: { title: "Technician", code: "TECHNICIAN" },
  },
];

async function installWorkforceApi(page: Page, role: "EMPLOYEE" | "LINE_MANAGER" | "MANAGER") {
  const permissions = [
    "session.self.read", "employee.self.read", "employee.department.read", "employee.self.read_compensation",
    "leave.self.read", "leave.self.create", "leave.self.cancel",
    ...(role === "LINE_MANAGER" ? ["leave.team.read", "leave.team.approve_line_manager"] : []),
    ...(role === "MANAGER" ? ["leave.management.read", "leave.management.approve_manager"] : []),
  ];
  await page.addInitScript(({ roleCode, rolePermissions }) => sessionStorage.setItem("medtech-hr-erp-backend-session-v2", JSON.stringify({
    id: "user-1", email: "noor@example.invalid", displayName: "Noor Employee", csrfToken: "csrf-token", roles: [roleCode], permissions: rolePermissions,
    departmentScopeIds: [], sessionId: "workforce-session", authProvider: "local", authorizationVersion: 1, employeeId: "employee-1",
  })), { roleCode: role, rolePermissions: permissions });
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === "/api/v1/employees" ? workforceEmployees
      : path === "/api/v1/employees/me" ? workforceEmployees[0]
      : path === "/api/v1/approvals/inbox" ? { leave: [], certificates: [], payroll: [] }
      : [];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data, meta: { total: Array.isArray(data) ? data.length : 0, page: 1, limit: 100, totalPages: 1 } }),
    });
  });
}

test("every application route renders with a specific document title", async ({ page }) => {
  await installUiApi(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));

  for (const [name, path] of Object.entries(navPaths)) {
    await test.step(name, async () => {
      await page.goto(path);
      await expect(page).toHaveTitle(`${name} | MedTech HR ERP`);
      await expect(page.locator(".content")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Access not available" })).toHaveCount(0);
    });
  }

  expect(errors).toEqual([]);
  await expect(page.getByRole("link", { name: "Business Trips" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Expenses" })).toHaveCount(0);
});

test("mobile dashboard, wide tables and shared dialog retain usable geometry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installUiApi(page);
  await page.goto("/");

  const hero = await page.locator(".hero-copy").boundingBox();
  const heading = await page.getByRole("heading", { name: "Today at MedTech" }).boundingBox();
  expect(hero).not.toBeNull();
  expect(heading).not.toBeNull();
  expect(heading!.width).toBeGreaterThan(260);
  expect(Math.abs(heading!.x - hero!.x)).toBeLessThan(2);

  const addEmployee = page.getByRole("button", { name: "Add employee" });
  await addEmployee.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveJSProperty("tagName", "DIALOG");
  await expect(dialog).toHaveAttribute("aria-labelledby", /.+/);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(addEmployee).toBeFocused();

  await page.goto("/system");
  const table = page.locator(".table-wrap:has(th:nth-child(4))").first();
  await expect(table).toBeVisible();
  expect(await table.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(table.locator("th").first()).toHaveCSS("position", "sticky");
});

test("unknown URLs show an explicit not-found page", async ({ page }) => {
  await page.goto("/not-a-module");
  await expect(page).toHaveTitle("Page not found | MedTech HR ERP");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("search input text clears its leading icon", async ({ page }) => {
  await installUiApi(page);
  await page.goto("/employees");
  const search = page.getByLabel("Search employees");
  expect(await search.evaluate(element => parseFloat(getComputedStyle(element).paddingLeft))).toBeGreaterThanOrEqual(36);
});

test("employee profile uses the wide dialog without leaving the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installUiApi(page, [{
    id: "employee-1", employeeCode: "MTC005", firstName: "Dima Osama Ahmad", lastName: "Alhawi",
    email: "mtc005@example.invalid", phone: "+974 5000 1234", hireDate: "2017-04-05", employmentStatus: "ACTIVE",
    department: { id: "department-1", name: "Diagnostics & POCT", code: "DPOCT" },
    position: { title: "Application Manager", code: "APP-MGR" }
  }], ["employee.hr.update", "payroll.read_compensation", "report.export"]);
  await page.goto("/employees");
  await expect(page.locator("article").filter({ hasText: "Dima Osama Ahmad Alhawi" })).toContainText("+974 5000 1234");
  await page.getByRole("button", { name: /Dima Osama Ahmad Alhawi/ }).click();

  const panel = page.locator(".modal:has(> .employee-profile)");
  const desktop = await panel.boundingBox();
  expect(desktop).not.toBeNull();
  expect(desktop!.width).toBeGreaterThanOrEqual(900);
  expect(desktop!.width).toBeLessThanOrEqual(920);
  expect(desktop!.x).toBeGreaterThanOrEqual(24);
  expect(desktop!.x + desktop!.width).toBeLessThanOrEqual(1416);
  await expect(panel.getByRole("button", { name: "Profile PDF" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Done" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await panel.boundingBox();
  expect(mobile).not.toBeNull();
  expect(mobile!.x).toBeGreaterThanOrEqual(0);
  expect(mobile!.x + mobile!.width).toBeLessThanOrEqual(390);
});

for (const role of ["EMPLOYEE", "LINE_MANAGER", "MANAGER"] as const) {
  test(`${role} uses the department workforce experience`, async ({ page }) => {
    await installWorkforceApi(page, role);
    await page.goto("/");

    await expect(page.getByRole("link", { name: "Attendance", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Team", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Employees", exact: true })).toBeVisible();
    await expect(page.getByText("Present today", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Payroll this month", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Open positions", { exact: true })).toHaveCount(0);
    if (role === "EMPLOYEE") await expect(page.getByRole("heading", { name: "Welcome, Noor" })).toBeVisible();
    else {
      await expect(page.getByRole("heading", { name: role === "LINE_MANAGER" ? "Service line management" : "Service management" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Approval inbox" })).toBeVisible();
    }

    await page.goto("/employees");
    await expect(page.getByRole("heading", { name: "Service Team" })).toBeVisible();
    const selfCard = page.locator("article").filter({ hasText: "Noor Employee" });
    const coworkerCard = page.locator("article").filter({ hasText: "Sam Colleague" });
    await expect(selfCard).toContainText("Total pay");
    await expect(coworkerCard).not.toContainText("Total pay");
    await expect(page.getByLabel("Filter employees by department")).toHaveCount(0);

    await page.goto("/me");
    await expect(page.locator('input[type="file"][accept*="image"]')).toHaveCount(0);

    await page.goto("/attendance");
    await expect(page.getByRole("heading", { name: "Access not available" })).toBeVisible();
  });
}

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

async function installUiApi(page: Page) {
  await page.addInitScript(value => sessionStorage.setItem("medtech-hr-erp-backend-session-v2", JSON.stringify(value)), session);
  await page.route("**/api/v1/**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data: [], meta: { total: 0, page: 1, limit: 100, totalPages: 1 } })
  }));
}

test("every application route renders with a specific document title", async ({ page }) => {
  await installUiApi(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));

  for (const [name, path] of Object.entries(navPaths)) {
    await page.goto(path);
    await expect(page).toHaveTitle(`${name} | MedTech HR ERP`);
    await expect(page.locator(".content")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Access not available" })).toHaveCount(0);
  }

  expect(errors).toEqual([]);
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

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
  await page.route("**/api/v1/**", route => {
    const pathname = new URL(route.request().url()).pathname;
    const data = pathname === "/api/v1/employees" ? employees : pathname === "/api/v1/notifications" ? [{ id: "notification-1", type: "TEST", title: "Test notification", message: "Visible notification content", createdAt: "2026-08-11T08:00:00.000Z", readAt: null }] : [];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data, meta: { total: data.length, page: 1, limit: 100, totalPages: 1, unread: pathname === "/api/v1/notifications" ? 1 : undefined } })
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
  await expect(page.getByLabel("Employee Code", { exact: true })).toHaveValue("MTC001");
  const employeeEditor = await page.locator(".modal:has(> .employee-editor)").boundingBox();
  expect(employeeEditor).not.toBeNull();
  expect(employeeEditor!.x + employeeEditor!.width).toBeLessThanOrEqual(390);
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

test("notification actions stay right-aligned and the popover remains visible beside responsive search", async ({ page }) => {
  await installUiApi(page, [], ["notification.self.read", "notification.self.manage"]);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 900, height: 768 }, { width: 390, height: 844 }]) {
    await test.step(`${viewport.width}x${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await page.goto("/");

      const trigger = page.getByRole("button", { name: /Notifications/ });
      const [topbar, search, actions] = await Promise.all([
        page.locator(".topbar").boundingBox(),
        page.getByRole("search").boundingBox(),
        page.locator(".topbar-actions").boundingBox()
      ]);
      expect(topbar).not.toBeNull();
      expect(search).not.toBeNull();
      expect(actions).not.toBeNull();
      expect(topbar!.x + topbar!.width - actions!.x - actions!.width).toBeLessThanOrEqual(48);
      expect(actions!.x + actions!.width).toBeLessThanOrEqual(topbar!.x + topbar!.width);
      if (viewport.width <= 900) expect(actions!.y + actions!.height).toBeLessThanOrEqual(search!.y);
      else expect(Math.abs(actions!.y + actions!.height / 2 - search!.y - search!.height / 2)).toBeLessThanOrEqual(4);

      await trigger.click();
      const popover = page.getByRole("dialog", { name: "Notifications" });
      await expect(popover).toContainText("Visible notification content");
      const box = await popover.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

      await page.keyboard.press("Escape");
      await expect(popover).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
});

test("employee add, edit, and profile dialogs use the wide layout without leaving the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installUiApi(page, [{
    id: "employee-1", employeeCode: "MTC005", firstName: "Dima Osama Ahmad", lastName: "Alhawi",
    email: "mtc005@example.invalid", phone: "+974 5000 1234", hireDate: "2017-04-05", employmentStatus: "ACTIVE",
    department: { id: "department-1", name: "Diagnostics & POCT", code: "DPOCT" },
    position: { title: "Application Manager", code: "APP-MGR" }
  }], ["employee.hr.update", "payroll.read_compensation", "report.export"]);
  await page.goto("/employees");
  await expect(page.locator("article").filter({ hasText: "Dima Osama Ahmad Alhawi" })).toContainText("+974 5000 1234");

  await page.getByRole("button", { name: "Add employee" }).click();
  const addPanel = page.locator(".modal:has(> .employee-editor)");
  const addDesktop = await addPanel.boundingBox();
  expect(addDesktop).not.toBeNull();
  expect(addDesktop!.width).toBeGreaterThanOrEqual(900);
  expect(addDesktop!.width).toBeLessThanOrEqual(920);
  await expect(addPanel.getByLabel("Employee Code", { exact: true })).toHaveValue("MTC006");
  await addPanel.getByRole("button", { name: "Cancel" }).click();

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
  const profileClose = await panel.getByRole("button", { name: "Close dialog" }).boundingBox();
  expect(profileClose).not.toBeNull();
  expect(profileClose!.x).toBeGreaterThan(desktop!.x + desktop!.width - profileClose!.width - 24);
  const profileBody = panel.locator(".employee-modal-body");
  const profileActions = panel.locator(".employee-modal-actions");
  await expect(profileBody).toHaveCSS("overflow-y", "auto");
  await expect(profileActions).toHaveCSS("position", "static");
  await profileBody.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const profileFooter = await profileActions.boundingBox();
  expect(profileFooter).not.toBeNull();
  expect(profileFooter!.y).toBeGreaterThanOrEqual(desktop!.y);
  expect(profileFooter!.y + profileFooter!.height).toBeLessThanOrEqual(desktop!.y + desktop!.height);

  await panel.getByRole("button", { name: "Edit", exact: true }).click();
  const editPanel = page.locator(".modal:has(> .employee-editor)");
  const editDesktop = await editPanel.boundingBox();
  expect(editDesktop).not.toBeNull();
  expect(editDesktop!.width).toBeGreaterThanOrEqual(900);
  expect(editDesktop!.width).toBeLessThanOrEqual(920);
  await expect(editPanel.getByLabel("Employee Code", { exact: true })).toHaveValue("MTC005");
  const editClose = await editPanel.getByRole("button", { name: "Close dialog" }).boundingBox();
  expect(editClose).not.toBeNull();
  expect(editClose!.x).toBeGreaterThan(editDesktop!.x + editDesktop!.width - editClose!.width - 24);
  await expect(editPanel.locator(".employee-modal-body")).toHaveCSS("overflow-y", "auto");
  await expect(editPanel.locator(".employee-modal-actions")).toHaveCSS("position", "static");

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await editPanel.boundingBox();
  expect(mobile).not.toBeNull();
  expect(mobile!.x).toBeGreaterThanOrEqual(0);
  expect(mobile!.x + mobile!.width).toBeLessThanOrEqual(390);
  const mobileClose = await editPanel.getByRole("button", { name: "Close dialog" }).boundingBox();
  expect(mobileClose).not.toBeNull();
  expect(mobileClose!.x + mobileClose!.width).toBeLessThanOrEqual(mobile!.x + mobile!.width - 12);
});

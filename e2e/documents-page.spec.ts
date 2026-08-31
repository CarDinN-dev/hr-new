import { expect, test, type Page } from "@playwright/test";

function envelope(data: unknown) { return { success: true, data }; }

async function installDocumentsApi(page: Page, role: "EMPLOYEE" | "HR" | "SUPER_ADMIN" = "EMPLOYEE", certificates = false) {
  const employee = { id: "employee-1", employeeCode: "EMP-001", firstName: "Noor", lastName: "Ahmed", email: "noor@example.invalid" };
  const elevated = role !== "EMPLOYEE";
  const permissions = elevated
    ? ["session.self.read", "employee.hr.read", "document.hr.read", "document.hr.manage"]
    : ["session.self.read", "employee.self.read", "document.self.read", "service_request.self.read", "service_request.self.create", "service_request.self.cancel", "service_request.self.download", "payroll.self.read_payslip"];
  if (certificates) permissions.push("service_request.hr.read", "service_request.hr.generate");
  const user = { id: `${role.toLowerCase()}-user`, email: employee.email, displayName: "Noor Ahmed", roles: [role], permissions, departmentScopeIds: [], sessionId: `${role.toLowerCase()}-session`, authProvider: "local", authorizationVersion: 1, employeeId: employee.id };
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(envelope(data)) });
    if (path === "/auth/me") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false, message: "Not signed in" }) });
    if (path === "/auth/login") return json({ csrfToken: "csrf-token", user }, 201);
    if (path === "/employees") return json([{ ...employee, phone: "", hireDate: "2022-01-01", employmentStatus: "ACTIVE", department: { id: "department-1", name: "Service", code: "SERVICE" }, position: { title: "Engineer", code: "ENGINEER" } }]);
    if (path === "/employees/me") return json({ ...employee, phone: "", hireDate: "2022-01-01", employmentStatus: "ACTIVE", department: { id: "department-1", name: "Service", code: "SERVICE" }, position: { title: "Engineer", code: "ENGINEER" } });
    if (path === "/documents") return json([{ id: "document-1", documentType: "OFFER_LETTER", fileName: "offer.pdf", documentNumber: "DOC-000001", createdAt: "2026-08-07T00:00:00.000Z", scanStatus: "CLEAN", employee }]);
    if (path === "/service-requests") return json(certificates ? [{ id: "request-1", requestType: "SALARY_CERTIFICATE", status: "SUBMITTED", version: 1, requesterUserId: user.id, subjectEmployeeId: employee.id, createdAt: "2026-08-07T00:00:00.000Z", subject: employee, documents: [] }] : []);
    if (path === "/payroll/payslips/me") return json([]);
    return json([]);
  });
}

test("certificate action menus float without growing their cards", async ({ page }) => {
  await installDocumentsApi(page, "HR", true);
  const viewport = { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.getByLabel("Email").fill("noor@example.invalid");
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.goto("/certificates");

  const card = page.locator(".workflow-card").filter({ hasText: "Salary Certificate" });
  const trigger = card.getByRole("button", { name: "Actions" });
  const cardHeight = (await card.boundingBox())!.height;
  await trigger.focus();
  await trigger.press("ArrowDown");
  const menu = page.locator(".card-actions-menu__items");
  await expect(menu).toContainText("Start review");
  expect(await menu.evaluate(element => getComputedStyle(element).position)).toBe("fixed");
  expect((await card.boundingBox())!.height).toBeCloseTo(cardHeight, 0);
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width);
  expect(menuBox.y).toBeGreaterThanOrEqual(0);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Documents is the employee document home", async ({ page }) => {
  await installDocumentsApi(page);
  await page.goto("/");
  await page.getByLabel("Email").fill("noor@example.invalid");
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("link", { name: "Documents", exact: true })).toBeVisible();
  await expect(page.getByText("Certificates", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Documents", exact: true }).click();
  await expect(page.getByText("Document library", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Filter documents by employee")).toBeVisible();
  await expect(page.getByText("Certificates", { exact: true })).toBeVisible();
  await expect(page.getByText("Document Templates", { exact: true })).toHaveCount(0);
  await expect(page.getByText("HR Documents & Letters", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Offer Letter", { exact: true })).toBeVisible();
});

for (const role of ["HR", "SUPER_ADMIN"] as const) {
  test(`${role} can generate a payslip for a selected month`, async ({ page }) => {
    await installDocumentsApi(page, role);
    await page.goto("/");
    await page.getByLabel("Email").fill("noor@example.invalid");
    await page.getByLabel("Password").fill("IntegrationPass123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("link", { name: "Documents", exact: true }).click();

    await page.getByLabel("Template").selectOption("payslip");
    await expect(page.getByLabel("Payslip month")).toBeVisible();
    await expect(page.getByLabel("Notes / purpose")).toHaveCount(0);
    await page.getByLabel("Payslip month").fill("2025-03");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Generate payslip", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("downloaded", { timeout: 10_000 });
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("Payslip-EMP-001-2025-03.pdf");
  });
}

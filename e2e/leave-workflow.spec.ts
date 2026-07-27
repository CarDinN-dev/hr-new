import { expect, test, type Page } from "@playwright/test";

const employee = { id: "employee-2", employeeCode: "EMP-002", firstName: "Amina", lastName: "Saleh" };
const leave = {
  id: "leave-1", version: 1, requesterUserId: "other-user", employeeId: employee.id, status: "PENDING_LINE_MANAGER", currentStage: "LINE_MANAGER", routeType: "STANDARD",
  startDate: "2099-04-20T00:00:00.000Z", endDate: "2099-04-20T00:00:00.000Z", totalDays: "1", isHalfDay: false,
  employee, leaveType: { id: "annual", name: "Annual leave" }, steps: [], decisions: [],
};

function envelope(data: unknown) {
  return { success: true, data };
}

async function installLeaveApi(page: Page) {
  const hr = { id: "hr-user", email: "hr@example.invalid", displayName: "HR User", roles: ["HR"], permissions: ["session.self.read", "leave.self.read", "leave.self.create", "leave.hr.read", "leave.hr.manage", "leave.hr.override"], departmentScopeIds: [], sessionId: "hr-session", authProvider: "local", authorizationVersion: 1, employeeId: "hr-employee" };
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const body = request.postDataJSON?.() as Record<string, unknown> | undefined;
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(envelope(data)) });
    if (path === "/auth/me") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false, message: "Not signed in" }) });
    if (path === "/auth/login") return json({ csrfToken: "csrf-token", user: hr }, 201);
    if (path === "/leave/requests") return json([leave]);
    if (path === "/leave/inbox") return json([]);
    if (path === "/leave/types") return json([{ id: "annual", name: "Annual leave", annualAllowanceDays: "30" }]);
    if (path === "/employees") return json([employee]);
    if (path === "/leave/submit" && request.method() === "POST") return json({ ...leave, id: "submitted-leave", requesterUserId: hr.id, employeeId: body?.employeeId }, 201);
    if (path === "/leave/leave-1/override" && request.method() === "POST") return json({ ...leave, status: "APPROVED", currentStage: null }, 201);
    return json([]);
  });
}

test("HR submits for an employee and immediately approves without a password", async ({ page }) => {
  await installLeaveApi(page);
  await page.goto("/");
  await page.getByLabel("Email").fill("hr@example.invalid");
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Leave" }).click();

  await page.getByLabel("Employee").selectOption(employee.id);
  await page.getByLabel("Reason").first().fill("HR submitted leave for employee");
  const submitted = page.waitForRequest(request => request.url().endsWith("/api/v1/leave/submit") && request.method() === "POST");
  await page.getByRole("button", { name: "Submit request" }).click();
  expect(JSON.parse((await submitted).postData() || "{}")).toMatchObject({ employeeId: employee.id });

  await page.getByRole("button", { name: "Override & approve" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("This immediately approves the leave and bypasses all remaining approval stages.")).toBeVisible();
  await expect(dialog.getByLabel("Current password")).toHaveCount(0);
  await dialog.getByLabel(/Decision reason/).fill("Immediate HR approval");
  const overridden = page.waitForRequest(request => request.url().endsWith("/api/v1/leave/leave-1/override") && request.method() === "POST");
  await dialog.getByRole("button", { name: "Confirm" }).click();
  expect(JSON.parse((await overridden).postData() || "{}")).toMatchObject({ targetStatus: "APPROVED", reason: "Immediate HR approval" });
});

test("employee submits their own leave and uses My HR and Settings safely", async ({ page }) => {
  const self = { id: "employee-self", employeeCode: "EMP-SELF", firstName: "Noor", lastName: "Ahmed", email: "noor@example.invalid" };
  const employeeUser = { id: "employee-user", email: self.email, displayName: "Noor Ahmed", roles: ["EMPLOYEE"], permissions: ["session.self.read", "session.self.revoke", "employee.self.read", "employee.self.update_basic", "leave.self.read", "leave.self.create", "leave.self.cancel", "service_request.self.read", "service_request.self.create", "service_request.self.cancel", "service_request.self.download"], departmentScopeIds: [], sessionId: "employee-session", authProvider: "local", authorizationVersion: 1, employeeId: self.id };
  const ownLeave = { ...leave, id: "own-leave", requesterUserId: employeeUser.id, employeeId: self.id, employee: self, status: "PENDING_LINE_MANAGER" };

  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const body = request.postDataJSON?.() as Record<string, unknown> | undefined;
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(envelope(data)) });
    if (path === "/auth/me") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false, message: "Not signed in" }) });
    if (path === "/auth/login") return json({ csrfToken: "csrf-token", user: employeeUser }, 201);
    if (path === "/employees") return json([self]);
    if (path === "/leave/mine") return json([ownLeave]);
    if (path === "/leave/types") return json([{ id: "annual", name: "Annual leave", annualAllowanceDays: "30" }]);
    if (path === "/leave/submit" && request.method() === "POST") return json({ ...ownLeave, id: "submitted-own-leave", reason: body?.reason }, 201);
    if (path === "/auth/sessions") return json([{ id: employeeUser.sessionId, provider: "local", userAgent: "Test browser", current: true }]);
    return json([]);
  });

  await page.goto("/");
  await page.getByLabel("Email").fill(self.email);
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Leave", exact: true }).click();

  await expect(page.getByLabel("Employee")).toHaveCount(0);
  await page.getByLabel("Reason").first().fill("Annual leave request");
  const submitted = page.waitForRequest(request => request.url().endsWith("/api/v1/leave/submit") && request.method() === "POST");
  await page.getByRole("button", { name: "Submit request" }).click();
  expect(JSON.parse((await submitted).postData() || "{}")).not.toHaveProperty("employeeId");
  await expect(page.getByText("Pending Line Manager", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "My HR", exact: true }).click();
  await expect(page.getByText("Current leave application", { exact: true })).toBeVisible();
  await expect(page.getByText("Pending Line Manager", { exact: true })).toBeVisible();
  await expect(page.getByText("Bank details", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Signed-in devices", { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Signed-in devices", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save settings", exact: true })).toHaveCount(0);
  await expect(page.getByText("Company Profile", { exact: true })).toHaveCount(0);
});

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

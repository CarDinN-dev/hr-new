import { expect, test, type Page } from "@playwright/test";

const employee = { id: "employee-2", employeeCode: "EMP-002", firstName: "Amina", lastName: "Saleh" };
const leave = {
  id: "leave-1", version: 1, requesterUserId: "other-user", employeeId: employee.id, status: "PENDING_LINE_MANAGER", currentStage: "LINE_MANAGER", routeType: "STANDARD",
  startDate: "2099-04-20T00:00:00.000Z", endDate: "2099-04-20T00:00:00.000Z", totalDays: "1", paidDays: "1", unpaidDays: "0", isHalfDay: false,
  employee, leaveType: { id: "annual", name: "Annual leave", code: "ANNUAL", requiresAttachment: false }, attachments: [], steps: [], decisions: [],
};
const leaveRecords = Array.from({ length: 16 }, (_, index) => index ? { ...leave, id: `leave-${index + 1}`, employee: { ...employee, employeeCode: `EMP-${String(index + 1).padStart(3, "0")}` } } : leave);

const leaveTypes = [
  { id: "annual", name: "Annual leave", code: "ANNUAL", annualAllowanceDays: "30", isPaid: true, requiresAttachment: false },
  { id: "sick", name: "Sick leave", code: "SICK", annualAllowanceDays: "14", isPaid: true, requiresAttachment: true },
  { id: "compassionate", name: "Compassionate leave", code: "COMPASSIONATE", annualAllowanceDays: "3", isPaid: true, requiresAttachment: false },
];

function balances(employeeId: string) {
  return leaveTypes.map(type => ({ id: `balance-${type.id}`, employeeId, leaveTypeId: type.id, year: 2099, totalDays: type.annualAllowanceDays, usedDays: "2", pendingDays: "1", availableDays: String(Number(type.annualAllowanceDays) - 3), noBalanceRequired: false, eligible: true, leaveType: type }));
}

function envelope(data: unknown) {
  return { success: true, data };
}

async function installLeaveApi(page: Page, requests = [leave], options: { previewEligible?: boolean; failFirstSubmit?: boolean } = {}) {
  const hr = { id: "hr-user", email: "hr@example.invalid", displayName: "HR User", roles: ["HR"], permissions: ["session.self.read", "leave.self.read", "leave.self.create", "leave.hr.read", "leave.hr.manage", "leave.hr.override"], departmentScopeIds: [], sessionId: "hr-session", authProvider: "local", authorizationVersion: 1, employeeId: "hr-employee" };
  let submitCount = 0;
  const submitKeys: string[] = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    let body: Record<string, unknown> | undefined;
    try { body = request.postDataJSON() as Record<string, unknown>; } catch { body = undefined; }
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(envelope(data)) });
    if (path === "/auth/me") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false, message: "Not signed in" }) });
    if (path === "/auth/login") return json({ csrfToken: "csrf-token", user: hr }, 201);
    if (path === "/leave/requests") return json(requests);
    if (path === "/leave/inbox") return json([]);
    if (path === "/leave/types") return json(leaveTypes);
    if (path === "/employees") return json([employee]);
    if (path === "/leave/balances") return json(balances(String(new URL(request.url()).searchParams.get("employeeId"))));
    if (path === "/leave/preview") return json({ totalDays: "1", paidDays: "1", unpaidDays: "0", eligible: options.previewEligible !== false, message: options.previewEligible === false ? "Insufficient leave balance" : null, requiresAttachment: body?.leaveTypeId === "sick", availableDays: options.previewEligible === false ? "0" : "27", noBalanceRequired: false });
    if (path === "/leave/submit" && request.method() === "POST") {
      submitCount += 1;
      submitKeys.push(request.headers()["idempotency-key"] || "");
      if (options.failFirstSubmit && submitCount === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, message: "Temporary response failure" }) });
      return json({ ...leave, id: "submitted-leave", requesterUserId: hr.id }, 201);
    }
    if (path === "/leave/leave-1/override" && request.method() === "POST") return json({ ...leave, status: "APPROVED", currentStage: null }, 201);
    return json([]);
  });
  return { submitCount: () => submitCount, submitKeys };
}

test("leave requests show 15 entries and search all loaded records", async ({ page }) => {
  await installLeaveApi(page, leaveRecords);
  await page.goto("/");
  await page.getByLabel("Email").fill("hr@example.invalid");
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Leave" }).click();

  await expect(page.getByText("Showing 15 of 16 active entries", { exact: true })).toBeVisible();
  const requestRows = page.getByRole("region", { name: "Leave requests" }).locator("tbody tr");
  await expect(requestRows).toHaveCount(15);
  await page.getByLabel("Search leave requests").fill("EMP-016");
  await expect(requestRows).toHaveCount(1);
  await expect(page.getByText("EMP-016 — Amina Saleh", { exact: true })).toBeVisible();
});

test("an ineligible preview cannot submit a leave request", async ({ page }) => {
  const api = await installLeaveApi(page, [leave], { previewEligible: false });
  await page.goto("/");
  await page.getByLabel("Email").fill("hr@example.invalid");
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Leave" }).click();

  await page.getByLabel("Employee").selectOption(employee.id);
  await page.getByLabel("Leave type").selectOption("annual");
  await expect(page.getByText("Insufficient leave balance", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit request" })).toBeDisabled();
  expect(api.submitCount()).toBe(0);
});

test("submission retries reuse one key and reset the confirmed form", async ({ page }) => {
  const api = await installLeaveApi(page, [leave], { failFirstSubmit: true });
  await page.goto("/");
  await page.getByLabel("Email").fill("hr@example.invalid");
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Leave" }).click();

  await page.getByLabel("Employee").selectOption(employee.id);
  await page.getByLabel("Leave type").selectOption("annual");
  await page.getByLabel("Reason").first().fill("Idempotent annual leave request");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText("Temporary response failure", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit request" }).click();

  await expect(page.getByLabel("Employee")).toHaveValue("");
  await expect(page.getByLabel("Leave type")).toHaveValue("");
  await expect(page.getByLabel("Reason").first()).toHaveValue("");
  expect(api.submitCount()).toBe(2);
  expect(api.submitKeys).toHaveLength(2);
  expect(api.submitKeys[0]).toBe(api.submitKeys[1]);
  await expect(page.getByText("Insufficient leave balance", { exact: true })).toHaveCount(0);
});

test("HR submits for an employee and immediately approves without a password", async ({ page }) => {
  await installLeaveApi(page);
  await page.goto("/");
  await page.getByLabel("Email").fill("hr@example.invalid");
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Leave" }).click();

  await page.getByLabel("Employee").selectOption(employee.id);
  await expect(page.getByText("27 days", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Leave type").selectOption("sick");
  await expect(page.getByLabel("Attachment (required)")).toBeVisible();
  await page.getByLabel("Leave type").selectOption("compassionate");
  await expect(page.getByLabel("Duration")).toBeDisabled();
  await page.getByLabel("Leave type").selectOption("annual");
  await page.getByLabel("Reason").first().fill("HR submitted leave for employee");
  const submitted = page.waitForRequest(request => request.url().endsWith("/api/v1/leave/submit") && request.method() === "POST");
  await page.getByRole("button", { name: "Submit request" }).click();
  expect((await submitted).postData()).toContain(employee.id);

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
  const cancelledOwnLeave = {
    ...ownLeave, version: 2, status: "CANCELLED", currentStage: null,
    steps: [
      { id: "own-step-1", stage: "LINE_MANAGER", status: "SKIPPED", sequence: 1, workflowVersion: 1, selfApprovalAllowed: false, reason: "Plans changed", assignees: [] },
      { id: "own-step-2", stage: "MANAGER", status: "SKIPPED", sequence: 2, workflowVersion: 1, selfApprovalAllowed: false, assignees: [] },
    ],
    decisions: [{ id: "cancel-decision", decisionType: "CANCEL", stage: "LINE_MANAGER", fromStatus: "PENDING_LINE_MANAGER", toStatus: "CANCELLED", reason: "Plans changed", createdAt: "2099-04-01T00:00:00.000Z", actor: { email: employeeUser.email } }],
  };
  let ownRequests: unknown[] = [ownLeave];

  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    let body: Record<string, unknown> | undefined;
    try { body = request.postDataJSON() as Record<string, unknown>; } catch { body = undefined; }
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(envelope(data)) });
    if (path === "/auth/me") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false, message: "Not signed in" }) });
    if (path === "/auth/login") return json({ csrfToken: "csrf-token", user: employeeUser }, 201);
    if (path === "/employees/me") return json({ ...self, phone: "+974 5555 0101", hireDate: "2022-01-01", employmentStatus: "ACTIVE", department: { id: "department-1", name: "Service", code: "SERVICE" }, position: { title: "Service Engineer", code: "SERVICE_ENGINEER" }, manager: { employeeCode: "MGR-1", firstName: "Maha", lastName: "Lead" } });
    if (path === "/leave/mine") return json(ownRequests);
    if (path === "/leave/types") return json(leaveTypes);
    if (path === "/leave/balances") return json(balances(self.id));
    if (path === "/leave/preview") return json({ totalDays: "1", paidDays: "1", unpaidDays: "0", eligible: true, requiresAttachment: false, availableDays: "27", noBalanceRequired: false });
    if (path === "/leave/submit" && request.method() === "POST") return json({ ...ownLeave, id: "submitted-own-leave" }, 201);
    if (path === "/leave/own-leave/cancel" && request.method() === "POST") { ownRequests = [cancelledOwnLeave]; return json(cancelledOwnLeave, 201); }
    if (path === "/leave/own-leave/timeline") return json(cancelledOwnLeave);
    if (path === "/auth/sessions") return json([{ id: employeeUser.sessionId, provider: "local", userAgent: "Test browser", current: true }]);
    return json([]);
  });

  await page.goto("/");
  await page.getByLabel("Email").fill(self.email);
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Leave", exact: true }).click();

  await expect(page.getByLabel("Employee")).toHaveCount(0);
  await page.getByLabel("Leave type").selectOption("annual");
  await page.getByLabel("Reason").first().fill("Annual leave request");
  const submitted = page.waitForRequest(request => request.url().endsWith("/api/v1/leave/submit") && request.method() === "POST");
  await page.getByRole("button", { name: "Submit request" }).click();
  expect((await submitted).postData()).not.toContain('name="employeeId"');
  await expect(page.getByText("Pending Line Manager", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const cancelDialog = page.getByRole("dialog");
  await cancelDialog.getByLabel(/Decision reason/).fill("Plans changed");
  await cancelDialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("button", { name: "Active (0)" })).toBeVisible();
  await page.getByRole("button", { name: "History (1)" }).click();
  const history = page.getByRole("region", { name: "Leave requests" });
  await expect(history.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(history.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
  await history.getByRole("button", { name: "Timeline" }).click();
  const timeline = page.getByRole("dialog");
  await expect(timeline.getByText("1. Line Manager · Skipped", { exact: true })).toBeVisible();
  await expect(timeline.getByText("2. Manager · Skipped", { exact: true })).toBeVisible();
  await timeline.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("link", { name: "My HR", exact: true }).click();
  await expect(page.getByText("Current leave application", { exact: true })).toBeVisible();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByText("Bank details", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Signed-in devices", { exact: true })).toHaveCount(0);
  const personalInformation = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Personal information" }) });
  await expect(personalInformation.getByLabel("Name")).toHaveValue("Noor Ahmed");
  await expect(personalInformation.getByLabel("Employee ID")).toHaveAttribute("readonly", "");
  await expect(personalInformation.getByLabel("Phone number")).toHaveValue("+974 5555 0101");
  await expect(personalInformation.getByLabel("Address", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save personal details" })).toHaveCount(0);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Signed-in devices", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save settings", exact: true })).toHaveCount(0);
  await expect(page.getByText("Company Profile", { exact: true })).toHaveCount(0);
});

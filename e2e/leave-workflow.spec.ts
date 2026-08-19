import { expect, test, type Page } from "@playwright/test";

const employee = { id: "employee-2", employeeCode: "EMP-002", firstName: "Amina", lastName: "Saleh" };
const leave = {
  id: "leave-1", version: 1, requesterUserId: "other-user", employeeId: employee.id, status: "PENDING_LINE_MANAGER", currentStage: "LINE_MANAGER", routeType: "STANDARD",
  startDate: "2099-04-20T00:00:00.000Z", endDate: "2099-04-20T00:00:00.000Z", totalDays: "1", paidDays: "1", unpaidDays: "0", isHalfDay: false,
  employee, leaveType: { id: "annual", name: "Annual leave", code: "ANNUAL", requiresAttachment: false }, attachments: [], steps: [], decisions: [],
};

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

async function installLeaveApi(page: Page) {
  const hr = { id: "hr-user", email: "hr@example.invalid", displayName: "HR User", roles: ["HR"], permissions: ["session.self.read", "leave.self.read", "leave.self.create", "leave.hr.read", "leave.hr.manage", "leave.hr.override"], departmentScopeIds: [], sessionId: "hr-session", authProvider: "local", authorizationVersion: 1, employeeId: "hr-employee" };
  let storedAttachments: Array<{ id: string; fileName: string; fileUrl: string; contentType: string; sizeBytes: number; scanStatus: string; createdAt: string }> = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    let body: Record<string, unknown> | undefined;
    try { body = request.postDataJSON() as Record<string, unknown>; } catch { body = undefined; }
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(envelope(data)) });
    if (path === "/auth/me") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false, message: "Not signed in" }) });
    if (path === "/auth/login") return json({ csrfToken: "csrf-token", user: hr }, 201);
    if (path === "/leave/requests") return json([{ ...leave, attachments: storedAttachments }]);
    if (path === "/leave/inbox") return json([]);
    if (path === "/leave/types") return json(leaveTypes);
    if (path === "/employees") return json([employee]);
    if (path === "/leave/balances") return json(balances(String(new URL(request.url()).searchParams.get("employeeId"))));
    if (path === "/leave/preview") return json({ totalDays: "1", paidDays: body?.leaveTypeId === "compassionate" ? "1" : "1", unpaidDays: "0", eligible: true, requiresAttachment: body?.leaveTypeId === "sick", availableDays: "27", noBalanceRequired: false });
    if (path === "/leave/submit" && request.method() === "POST") return json({ ...leave, id: "submitted-leave", requesterUserId: hr.id }, 201);
    if (path === "/leave/leave-1/attachment" && request.method() === "POST") {
      const fileName = request.postData()?.match(/filename="([^"]+)"/)?.[1] || "attachment.pdf";
      storedAttachments = [{ id: "attachment-1", fileName, fileUrl: `/attachments/${fileName}`, contentType: "application/pdf", sizeBytes: 1024, scanStatus: "CLEAN", createdAt: "2099-04-01T00:00:00.000Z" }];
      return json({ ...leave, attachments: storedAttachments });
    }
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

  await page.getByLabel("Employee").fill("Amina");
  await expect(page.getByRole("option", { name: "EMP-002 — Amina Saleh" })).toBeVisible();
  await page.getByRole("option", { name: "EMP-002 — Amina Saleh" }).click();
  await expect(page.getByText("27", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Leave type").selectOption("sick");
  await expect(page.getByLabel("Attachment (required)")).toBeVisible();
  await page.getByLabel("Attachment (required)").setInputFiles({ name: "medical-note.pdf", mimeType: "application/pdf", buffer: Buffer.from("medical note") });
  await expect(page.getByText("medical-note.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready to save with this request", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Remove selected attachment" }).click();
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

test("leave attachments stay on the existing persistence paths", async ({ page }) => {
  await installLeaveApi(page);
  await page.goto("/");
  await page.getByLabel("Email").fill("hr@example.invalid");
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Leave" }).click();

  await page.getByLabel("Employee").fill("Amina");
  await page.getByRole("option", { name: "EMP-002 — Amina Saleh" }).click();
  await page.getByLabel("Leave type").selectOption("sick");
  await page.getByLabel("Attachment (required)").setInputFiles({ name: "medical-note.pdf", mimeType: "application/pdf", buffer: Buffer.from("medical note") });
  await expect(page.getByText("Your attachment will be saved with this request.")).toBeVisible();
  const submitted = page.waitForRequest(request => request.url().endsWith("/api/v1/leave/submit") && request.method() === "POST");
  await page.getByRole("button", { name: "Submit request" }).click();
  expect((await submitted).postData()).toContain('filename="medical-note.pdf"');

  const saved = page.waitForRequest(request => request.url().endsWith("/api/v1/leave/leave-1/attachment") && request.method() === "POST");
  await page.getByLabel("Add attachment for Annual leave request").setInputFiles({ name: "manager-note.pdf", mimeType: "application/pdf", buffer: Buffer.from("manager note") });
  expect((await saved).postData()).toContain('filename="manager-note.pdf"');
  await expect(page.getByRole("link", { name: "manager-note.pdf" })).toBeVisible();
});

test("employee submits their own leave and uses My HR and Settings safely", async ({ page }) => {
  const self = { id: "employee-self", employeeCode: "EMP-SELF", firstName: "Noor", lastName: "Ahmed", email: "noor@example.invalid" };
  const employeeUser = { id: "employee-user", email: self.email, displayName: "Noor Ahmed", roles: ["EMPLOYEE"], permissions: ["session.self.read", "session.self.revoke", "employee.self.read", "employee.self.update_basic", "leave.self.read", "leave.self.create", "leave.self.cancel", "service_request.self.read", "service_request.self.create", "service_request.self.cancel", "service_request.self.download"], departmentScopeIds: [], sessionId: "employee-session", authProvider: "local", authorizationVersion: 1, employeeId: self.id };
  const ownLeave = { ...leave, id: "own-leave", requesterUserId: employeeUser.id, employeeId: self.id, employee: self, status: "PENDING_LINE_MANAGER" };

  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    let body: Record<string, unknown> | undefined;
    try { body = request.postDataJSON() as Record<string, unknown>; } catch { body = undefined; }
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(envelope(data)) });
    if (path === "/auth/me") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false, message: "Not signed in" }) });
    if (path === "/auth/login") return json({ csrfToken: "csrf-token", user: employeeUser }, 201);
    if (path === "/employees/me") return json({ ...self, phone: "+974 5555 0101", hireDate: "2022-01-01", employmentStatus: "ACTIVE", department: { id: "department-1", name: "Service", code: "SERVICE" }, position: { title: "Service Engineer", code: "SERVICE_ENGINEER" }, manager: { employeeCode: "MGR-1", firstName: "Maha", lastName: "Lead" } });
    if (path === "/leave/mine") return json([ownLeave]);
    if (path === "/leave/types") return json(leaveTypes);
    if (path === "/leave/balances") return json(balances(self.id));
    if (path === "/leave/preview") return json({ totalDays: "1", paidDays: "1", unpaidDays: "0", eligible: true, requiresAttachment: false, availableDays: "27", noBalanceRequired: false });
    if (path === "/leave/submit" && request.method() === "POST") return json({ ...ownLeave, id: "submitted-own-leave" }, 201);
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
  expect((await submitted).postData()).not.toContain('name="employeeId"');
  await expect(page.getByText("Pending Line Manager", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "My HR", exact: true }).click();
  await expect(page.getByText("Current leave application", { exact: true })).toBeVisible();
  await expect(page.getByText("Pending Line Manager", { exact: true })).toBeVisible();
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

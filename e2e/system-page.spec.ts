import { expect, test, type Page } from "@playwright/test";

type User = { id: string; email: string; isActive: boolean; localLoginEnabled: boolean; microsoftLoginEnabled: boolean; authorizationVersion: number; roles: Array<{ role: Role }>; permissionOverrides: unknown[] };
type Role = { id: string; code: string; displayName: string; description?: string; version: number; isBuiltIn: boolean; isActive: boolean; protection: "STANDARD" | "PROTECTED" | "SUPER_ADMIN"; inherits: string[]; permissions?: Array<{ permission: Permission }> };
type Permission = { id: string; code: string; displayName: string; category: string; isProtected: boolean; isDeprecated: boolean };

const permissions: Permission[] = [
  { id: "permission-department-read", code: "department.read", displayName: "Read departments", category: "Organization", isProtected: false, isDeprecated: false },
  { id: "permission-role-protected", code: "role.assign_protected", displayName: "Assign protected roles", category: "System", isProtected: true, isDeprecated: false },
];
const roles: Role[] = [
  { id: "role-admin", code: "ADMIN", displayName: "Administrator", version: 1, isBuiltIn: true, isActive: true, protection: "PROTECTED", inherits: ["EMPLOYEE"], permissions: [] },
  { id: "role-coo", code: "COO", displayName: "Chief Operating Officer", version: 1, isBuiltIn: true, isActive: true, protection: "STANDARD", inherits: ["EMPLOYEE"], permissions: [] },
  { id: "role-cpo", code: "CPO", displayName: "Chief People Officer", version: 1, isBuiltIn: true, isActive: true, protection: "STANDARD", inherits: ["EMPLOYEE"], permissions: [] },
  { id: "role-employee", code: "EMPLOYEE", displayName: "Employee", version: 1, isBuiltIn: true, isActive: true, protection: "STANDARD", inherits: [], permissions: [] },
  { id: "role-hr", code: "HR", displayName: "HR", version: 1, isBuiltIn: true, isActive: true, protection: "STANDARD", inherits: ["EMPLOYEE"], permissions: [] },
  { id: "role-line-manager", code: "LINE_MANAGER", displayName: "Line Manager", version: 1, isBuiltIn: true, isActive: true, protection: "STANDARD", inherits: ["EMPLOYEE"], permissions: [] },
  { id: "role-manager", code: "MANAGER", displayName: "Manager", version: 1, isBuiltIn: true, isActive: true, protection: "STANDARD", inherits: ["EMPLOYEE"], permissions: [] },
  { id: "role-super-admin", code: "SUPER_ADMIN", displayName: "Super Administrator", version: 1, isBuiltIn: true, isActive: true, protection: "SUPER_ADMIN", inherits: ["EMPLOYEE", "HR", "LINE_MANAGER", "MANAGER", "COO", "CPO", "ADMIN"], permissions: [] },
  { id: "role-custom", code: "CUSTOM_VIEWER", displayName: "Custom Viewer", version: 1, isBuiltIn: false, isActive: true, protection: "STANDARD", inherits: [], permissions: [] },
];

function envelope(data: unknown, meta?: unknown) {
  return { success: true, data, ...(meta === undefined ? {} : { meta }) };
}

async function installSystemApi(page: Page, sessionRoles = ["SUPER_ADMIN"], userCount = 2) {
  const admin = { id: "admin-user", email: "super.admin@example.invalid", displayName: "Super Admin", roles: sessionRoles, permissions: ["session.self.read", "employee.read_all", "user.read", "user.manage", "permission.assign", "role.assign", "user.deactivate", "user.delete_soft", "role.read", "role.manage", "permission.read", "session.manage", "workflow.policy.read", "workflow.policy.manage", "workflow.delegation.read", "workflow.delegation.manage"], departmentScopeIds: [], sessionId: "admin-session", authProvider: "local", authorizationVersion: 1, employeeId: "admin-employee" };
  const hrRole = roles.find(role => role.code === "HR")!;
  const employeeRole = roles.find(role => role.code === "EMPLOYEE")!;
  const adminRoles = sessionRoles.map(code => roles.find(role => role.code === code)).filter((role): role is Role => Boolean(role));
  const target: User = { id: "target-user", email: "target@example.invalid", isActive: true, localLoginEnabled: true, microsoftLoginEnabled: false, authorizationVersion: 1, roles: [{ role: hrRole }, { role: employeeRole }], permissionOverrides: [] };
  const users: User[] = [{ ...target }, { id: admin.id, email: admin.email, isActive: true, localLoginEnabled: true, microsoftLoginEnabled: false, authorizationVersion: 1, roles: adminRoles.map(role => ({ role })), permissionOverrides: [] }];
  users.push(...Array.from({ length: Math.max(0, userCount - users.length) }, (_, index) => ({ id: `user-${index + 1}`, email: `user-${index + 1}@example.invalid`, isActive: true, localLoginEnabled: true, microsoftLoginEnabled: false, authorizationVersion: 1, roles: [{ role: hrRole }], permissionOverrides: [] })));
  const employees = [
    { id: "admin-employee", employeeCode: "ADM-001", firstName: "Amina", lastName: "Admin", email: admin.email, hireDate: "2020-01-01", employmentStatus: "ACTIVE", department: { id: "department-executive", name: "Executive Office", code: "EXEC" }, position: { title: "Platform Administrator", code: "PLATFORM_ADMIN" }, user: { roles: sessionRoles.map(code => ({ role: { code } })) }, manager: null, lineManager: null },
    { id: "coo-employee", employeeCode: "EXE-001", firstName: "Omar", lastName: "Operations", email: "coo@example.invalid", hireDate: "2018-01-01", employmentStatus: "ACTIVE", department: { id: "department-executive", name: "Executive Office", code: "EXEC" }, position: { title: "Chief Operating Officer", code: "COO" }, user: { roles: [{ role: { code: "COO" } }] }, manager: null, lineManager: null },
    { id: "cpo-employee", employeeCode: "EXE-002", firstName: "Priya", lastName: "People", email: "cpo@example.invalid", hireDate: "2019-01-01", employmentStatus: "ACTIVE", department: { id: "department-hr", name: "Human Resources", code: "HR" }, position: { title: "Chief People Officer", code: "CPO" }, user: { roles: [{ role: { code: "CPO" } }] }, manager: { id: "coo-employee", employeeCode: "EXE-001", firstName: "Omar", lastName: "Operations" }, lineManager: null },
    { id: "hr-manager", employeeCode: "HR-MGR", firstName: "Dana", lastName: "Manager", email: "hr.manager@example.invalid", hireDate: "2020-02-01", employmentStatus: "ACTIVE", department: { id: "department-hr", name: "Human Resources", code: "HR" }, position: { title: "People Manager", code: "PEOPLE_MANAGER" }, user: { roles: [{ role: { code: "EMPLOYEE" } }] }, manager: { id: "cpo-employee", employeeCode: "EXE-002", firstName: "Priya", lastName: "People" }, lineManager: null },
    { id: "hr-line-manager", employeeCode: "HR-LM", firstName: "Lina", lastName: "Lead", email: "hr.lead@example.invalid", hireDate: "2021-02-01", employmentStatus: "ACTIVE", department: { id: "department-hr", name: "Human Resources", code: "HR" }, position: { title: "People Lead", code: "PEOPLE_LEAD" }, user: { roles: [{ role: { code: "EMPLOYEE" } }] }, manager: { id: "hr-manager", employeeCode: "HR-MGR", firstName: "Dana", lastName: "Manager" }, lineManager: null },
    { id: "target-employee", employeeCode: "EMP-001", firstName: "Taylor", lastName: "Target", email: target.email, hireDate: "2022-04-10", employmentStatus: "ON_LEAVE", department: { id: "department-hr", name: "Human Resources", code: "HR" }, position: { title: "HR Specialist", code: "HR_SPECIALIST" }, user: { roles: [{ role: { code: "HR" } }, { role: { code: "EMPLOYEE" } }] }, manager: null, lineManager: { id: "hr-line-manager", employeeCode: "HR-LM", firstName: "Lina", lastName: "Lead" } },
    { id: "operations-manager", employeeCode: "OPS-001", firstName: "Morgan", lastName: "Manager", email: "manager@example.invalid", hireDate: "2021-06-01", employmentStatus: "ACTIVE", department: { id: "department-operations", name: "Operations", code: "OPS" }, position: { title: "Operations Manager", code: "OPS_MANAGER" }, user: { roles: [{ role: { code: "MANAGER" } }] }, manager: { id: "coo-employee", employeeCode: "EXE-001", firstName: "Omar", lastName: "Operations" }, lineManager: { id: "coo-employee", employeeCode: "EXE-001", firstName: "Omar", lastName: "Operations" } },
    { id: "coo-direct", employeeCode: "OPS-002", firstName: "Corey", lastName: "Direct", email: "coo.direct@example.invalid", hireDate: "2022-01-01", employmentStatus: "ACTIVE", department: { id: "department-executive", name: "Executive Office", code: "EXEC" }, position: { title: "Executive Analyst", code: "EXEC_ANALYST" }, user: { roles: [{ role: { code: "EMPLOYEE" } }] }, manager: { id: "coo-employee", employeeCode: "EXE-001", firstName: "Omar", lastName: "Operations" }, lineManager: { id: "coo-employee", employeeCode: "EXE-001", firstName: "Omar", lastName: "Operations" } },
    { id: "operations-report", employeeCode: "OPS-003", firstName: "Riley", lastName: "Report", email: "operations.report@example.invalid", hireDate: "2022-06-01", employmentStatus: "ACTIVE", department: { id: "department-operations", name: "Operations", code: "OPS" }, position: { title: "Operations Specialist", code: "OPS_SPECIALIST" }, user: { roles: [{ role: { code: "EMPLOYEE" } }] }, manager: { id: "operations-manager", employeeCode: "OPS-001", firstName: "Morgan", lastName: "Manager" }, lineManager: null },
    { id: "operations-line-lead", employeeCode: "OPS-004", firstName: "Avery", lastName: "Lead", email: "operations.lead@example.invalid", hireDate: "2022-07-01", employmentStatus: "ACTIVE", department: { id: "department-operations", name: "Operations", code: "OPS" }, position: { title: "Service Lead", code: "SERVICE_LEAD" }, user: { roles: [{ role: { code: "EMPLOYEE" } }] }, manager: { id: "operations-manager", employeeCode: "OPS-001", firstName: "Morgan", lastName: "Manager" }, lineManager: null },
    { id: "operations-report-3", employeeCode: "OPS-005", firstName: "Jordan", lastName: "Field", email: "operations.field@example.invalid", hireDate: "2022-08-01", employmentStatus: "ACTIVE", department: { id: "department-operations", name: "Operations", code: "OPS" }, position: { title: "Field Coordinator", code: "FIELD_COORDINATOR" }, user: { roles: [{ role: { code: "EMPLOYEE" } }] }, manager: { id: "operations-manager", employeeCode: "OPS-001", firstName: "Morgan", lastName: "Manager" }, lineManager: null },
    { id: "operations-grandchild", employeeCode: "OPS-006", firstName: "Casey", lastName: "Nested", email: "operations.nested@example.invalid", hireDate: "2023-01-01", employmentStatus: "ACTIVE", department: { id: "department-operations", name: "Operations", code: "OPS" }, position: { title: "Service Coordinator", code: "SERVICE_COORDINATOR" }, user: { roles: [{ role: { code: "EMPLOYEE" } }] }, manager: null, lineManager: { id: "operations-line-lead", employeeCode: "OPS-004", firstName: "Avery", lastName: "Lead" } },
  ];
  const policies = [
    { id: "policy-hr", workflowType: "LEAVE", stage: "HR", mode: "ANY_ONE", version: 1, members: [] },
    { id: "policy-cpo", workflowType: "LEAVE", stage: "CPO", mode: "PRIMARY_APPROVER", version: 1, primaryUser: { id: admin.id, email: admin.email }, members: [] },
  ];
  const delegations: Array<Record<string, unknown>> = [];
  const sessions = [{ id: "target-session", provider: "local", lastSeenAt: new Date().toISOString(), user: { id: target.id, email: target.email } }];

  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const body = request.postDataJSON?.() as Record<string, unknown> | undefined;
    const json = (data: unknown, status = 200, meta?: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(envelope(data, meta)) });
    if (path === "/auth/me") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false, message: "Not signed in" }) });
    if (path === "/auth/login") return json({ csrfToken: "csrf-token", user: admin }, 201);
    if (path === "/auth/step-up/local") return json({ reauthenticatedAt: new Date().toISOString() }, 201);
    if (path === "/system/users" && request.method() === "GET") {
      const search = url.searchParams.get("search")?.toLowerCase();
      const roleId = url.searchParams.get("roleId");
      const pageNumber = Number(url.searchParams.get("page") || "1");
      const limit = Number(url.searchParams.get("limit") || "20");
      const matches = users.filter(user => (!search || user.email.toLowerCase().includes(search)) && (!roleId || user.roles.some(item => item.role.id === roleId)));
      return json(matches.slice((pageNumber - 1) * limit, pageNumber * limit), 200, { total: matches.length, page: pageNumber, limit, totalPages: Math.ceil(matches.length / limit) || 1 });
    }
    if (path === "/system/roles" && request.method() === "GET") return json(roles);
    if (path === "/employees" && request.method() === "GET") return json(employees);
    if (path === "/system/permissions") return json(permissions);
    if (path === "/system/sessions" && request.method() === "GET") return json(sessions, 200, { total: sessions.length, page: 1, limit: 20, totalPages: 1 });
    if (path === "/system/workflow-policy" && request.method() === "GET") return json(policies);
    if (path === "/system/delegations" && request.method() === "GET") return json(delegations);
    if (path === "/system/users" && request.method() === "POST") {
      if (body?.email === "duplicate@example.invalid") {
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ success: false, message: "Email address is already in use" }) });
      }
      const created: User = { id: `created-${users.length}`, email: String(body?.email), isActive: true, localLoginEnabled: body?.localLoginEnabled === true, microsoftLoginEnabled: body?.microsoftLoginEnabled === true, authorizationVersion: 1, roles: [{ role: roles.find(role => role.id === (body?.roleIds as string[])?.[0])! }], permissionOverrides: [] };
      users.unshift(created);
      return json(created, 201);
    }
    if (path === "/system/roles" && request.method() === "POST") {
      const created: Role = { id: "role-custom", code: String(body?.code), displayName: String(body?.displayName), version: 1, isBuiltIn: false, isActive: true, protection: "STANDARD", inherits: [], permissions: [] };
      roles.push(created);
      return json(created, 201);
    }
    if (path === "/system/roles/role-custom/inheritance" && request.method() === "PUT") {
      const custom = roles.find(role => role.id === "role-custom")!;
      custom.inherits = (body?.parentRoleIds as string[] ?? []).map(id => roles.find(role => role.id === id)?.code).filter((code): code is string => Boolean(code));
      custom.version += 1;
      return json(custom);
    }
    if (path === `/system/users/${target.id}/status`) {
      target.isActive = body?.isActive === true; target.authorizationVersion += 1;
      return json(target);
    }
    if (path === `/system/users/${target.id}/overrides`) return json({ id: "override-1" }, 201);
    if (path === "/system/sessions/revoke-all") return json({ revokedCount: 1, affectedUserCount: 1, currentSessionRevoked: false }, 201);
    if (path === "/system/delegations" && request.method() === "POST") {
      const delegation = { id: "delegation-1", workflowType: "LEAVE", stage: body?.stage, startsAt: body?.startsAt, endsAt: body?.endsAt, version: 1, delegator: { id: target.id, email: target.email }, delegate: { id: admin.id, email: admin.email } };
      delegations.unshift(delegation);
      return json(delegation, 201);
    }
    if (path.startsWith("/system/workflow-policy/") && request.method() === "PUT") return json({ id: "policy-hr" });
    if (path.startsWith("/system/") && request.method() !== "GET") return json({ id: "updated" }, 201);
    return json([]);
  });
}

async function loginAndOpenSystem(page: Page) {
  await installSystemApi(page);
  await page.goto("/");
  await page.getByLabel("Email").fill("super.admin@example.invalid");
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "System" }).click();
  await expect(page.getByRole("heading", { name: "Create login user" })).toBeVisible();
}

test("Users and access paginates at 15 and supports 50 per page", async ({ page }) => {
  await installSystemApi(page, ["SUPER_ADMIN"], 16);
  await page.goto("/");
  await page.getByLabel("Email").fill("super.admin@example.invalid");
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "System" }).click();

  const usersPanel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Users and access" }) });
  await expect(usersPanel.getByText("Page 1 of 2 · 16 users")).toBeVisible();
  await expect(usersPanel.getByRole("button", { name: "Previous" })).toBeDisabled();
  await usersPanel.getByRole("button", { name: "Next" }).click();
  await expect(usersPanel.getByText("Page 2 of 2 · 16 users")).toBeVisible();
  await expect(usersPanel.getByText("user-14@example.invalid")).toBeVisible();

  await usersPanel.getByLabel("Users per page").selectOption("50");
  await expect(usersPanel.getByText("Page 1 of 1 · 16 users")).toBeVisible();
  await expect(usersPanel.getByText("user-14@example.invalid")).toBeVisible();
});

test("Super Admin can create a local account without Entra provisioning", async ({ page }) => {
  await loginAndOpenSystem(page);
  await expect(page.getByText("Choose Local for an email-and-password account.")).toBeVisible();
  await expect(page.getByText("Current user")).toBeVisible();
  await expect(page.getByRole("row", { name: /super\.admin@example\.invalid.*Current user/ }).getByRole("button")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Local", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Sign-in methods Microsoft Local" })).not.toBeChecked();
  await page.locator('input[type="email"]').last().fill("local.user@example.invalid");
  await page.getByLabel("Initial password").fill("LocalAccount123!");
  await page.getByRole("checkbox", { name: "HR", exact: true }).click();
  await page.getByRole("checkbox", { name: "Super Administrator (super_admin)", exact: true }).click();
  await page.getByLabel("Reason").first().fill("System UI local-account regression");
  const created = page.waitForResponse(response => response.url().endsWith("/api/v1/system/users") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create user" }).click();
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(201);
  const payload = JSON.parse(createdResponse.request().postData() || "{}");
  expect(payload).toMatchObject({ localLoginEnabled: true, microsoftLoginEnabled: false, email: "local.user@example.invalid" });
  await expect(page.getByText("local.user@example.invalid")).toBeVisible();

  await page.getByRole("checkbox", { name: "Local", exact: true }).click();
  await page.locator('input[type="email"]').last().fill("duplicate@example.invalid");
  await page.getByLabel("Initial password").fill("LocalAccount123!");
  await page.getByRole("checkbox", { name: "HR", exact: true }).click();
  await page.getByLabel("Reason").first().fill("System UI duplicate-account regression");
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByText("Email address is already in use")).toBeVisible();
});

test("Hierarchy is hidden and denied for non-administrators", async ({ page }) => {
  await installSystemApi(page, ["EMPLOYEE"]);
  await page.goto("/");
  await page.getByLabel("Email").fill("super.admin@example.invalid");
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("link", { name: "Hierarchy" })).toHaveCount(0);
  await page.evaluate(() => { window.history.pushState({}, "", "/hierarchy"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await expect(page.getByRole("heading", { name: "Access not available" })).toBeVisible();
});

test("Admin can explore and export the department role hierarchy without changing the organization chart", async ({ page }) => {
  await installSystemApi(page, ["ADMIN"]);
  await page.goto("/");
  await page.getByLabel("Email").fill("super.admin@example.invalid");
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Hierarchy" }).click();
  await expect(page.getByRole("heading", { name: "Organizational hierarchy" })).toBeVisible();
  await expect(page.locator(".organization-chart")).toBeVisible();

  const organizationTab = page.getByRole("tab", { name: "Organizational hierarchy" });
  const roleTab = page.getByRole("tab", { name: "Role hierarchy" });
  await expect(organizationTab).toHaveAttribute("aria-selected", "true");
  await organizationTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(roleTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("group", { name: "Company role hierarchy" })).toBeVisible();
  await expect(page.locator(".company-role-toolbar")).toHaveCSS("position", "relative");
  const flowViewport = page.getByRole("region", { name: "Interactive role hierarchy canvas" });
  const canvasControls = page.getByRole("group", { name: "Canvas navigation controls" });
  const zoomValue = canvasControls.locator("output");
  await expect(flowViewport).toHaveAttribute("aria-describedby", "company-role-canvas-help");
  await expect(zoomValue).toHaveText("100%");
  await page.getByRole("button", { name: "Zoom out role hierarchy" }).click();
  await expect(zoomValue).toHaveText("90%");
  await page.getByRole("button", { name: "Zoom in role hierarchy" }).click();
  await expect(zoomValue).toHaveText("100%");
  await flowViewport.focus();
  await page.keyboard.press("=");
  await expect(zoomValue).toHaveText("110%");
  await page.keyboard.press("0");
  await expect(zoomValue).toHaveText("100%");
  const coo = page.getByRole("button", { name: /COO.*Chief Operating Officer.*Omar Operations/ });
  const cpo = page.getByRole("button", { name: /CPO.*Chief People Officer.*Priya People/ });
  await expect(coo).toBeVisible();
  await expect(cpo).toBeVisible();
  expect((await coo.boundingBox())!.y).toBeLessThan((await cpo.boundingBox())!.y);
  await expect(page.locator('.company-role-canvas .role-flowchart-line[data-source-id="company-coo"][data-target-id="company-cpo"]')).toHaveCount(1);

  const cooChildren = page.locator(".company-role-executive-children");
  const executiveOffice = cooChildren.locator(".company-role-department-branch").filter({ has: page.getByRole("button", { name: /Executive Office.*1 person.*1 direct report/ }) });
  await expect(executiveOffice.getByText("Corey Direct")).toBeVisible();
  await expect(page.locator('.company-role-canvas .role-flowchart-line[data-source-id="company-coo"][data-target-id="coo-department-0"]')).toHaveCount(1);

  const operations = cooChildren.locator(".company-role-department-branch").filter({ has: page.getByRole("button", { name: /Operations.*5 people.*1 direct report/ }) });
  await expect(operations.locator(".company-role-cards")).toHaveCSS("display", "flex");
  const operationsManager = operations.getByRole("button", { name: /Morgan Manager.*Manager.*OPS-001/ });
  await expect(operationsManager).toHaveAttribute("aria-expanded", "false");
  await operationsManager.scrollIntoViewIfNeeded();
  await operationsManager.evaluate(element => element.focus({ preventScroll: true }));
  const managerBeforeExpansion = await operationsManager.evaluate(element => {
    const viewport = element.closest(".company-role-viewport")!.getBoundingClientRect();
    const node = element.getBoundingClientRect();
    return { x: node.left - viewport.left, y: node.top - viewport.top };
  });
  await page.keyboard.press("Enter");
  await expect.poll(async () => operationsManager.evaluate((element, before) => {
    const viewport = element.closest(".company-role-viewport")!.getBoundingClientRect();
    return Math.abs(element.getBoundingClientRect().left - viewport.left - before.x);
  }, managerBeforeExpansion)).toBeLessThan(64);
  await expect.poll(async () => operationsManager.evaluate((element, before) => {
    const viewport = element.closest(".company-role-viewport")!.getBoundingClientRect();
    return Math.abs(element.getBoundingClientRect().top - viewport.top - before.y);
  }, managerBeforeExpansion)).toBeLessThan(64);
  const operationsReport = operations.getByRole("button", { name: /Riley Report.*Employee.*OPS-003/ });
  const operationsLineLead = operations.getByRole("button", { name: /Avery Lead.*Line Manager.*OPS-004/ });
  const operationsFieldReport = operations.getByRole("button", { name: /Jordan Field.*Employee.*OPS-005/ });
  await expect(operationsReport).toContainText("Reports toMorgan Manager");
  const directReportBoxes = await Promise.all([operationsLineLead, operationsFieldReport, operationsReport].map(locator => locator.boundingBox()));
  expect(directReportBoxes.every(Boolean)).toBe(true);
  expect(Math.max(...directReportBoxes.map(box => box!.y)) - Math.min(...directReportBoxes.map(box => box!.y))).toBeLessThan(3);
  const reportsByX = directReportBoxes.map(box => box!).sort((left, right) => left.x - right.x);
  expect(reportsByX[0].x + reportsByX[0].width).toBeLessThanOrEqual(reportsByX[1].x);
  expect(reportsByX[1].x + reportsByX[1].width).toBeLessThanOrEqual(reportsByX[2].x);
  const managerBox = (await operationsManager.boundingBox())!;
  const reportsCenter = (reportsByX[0].x + reportsByX[0].width / 2 + reportsByX[2].x + reportsByX[2].width / 2) / 2;
  expect(Math.abs(managerBox.x + managerBox.width / 2 - reportsCenter)).toBeLessThan(4);
  for (const reportId of ["operations-line-lead", "operations-report-3", "operations-report"]) await expect(page.locator(`.company-role-canvas .role-flowchart-line[data-source-id="reporting-operations-manager"][data-target-id="reporting-${reportId}"]`)).toHaveCount(1);
  await operationsLineLead.click();
  const nestedReport = operations.getByRole("button", { name: /Casey Nested.*Employee.*OPS-006/ });
  await expect(nestedReport).toBeVisible();
  expect((await nestedReport.boundingBox())!.y).toBeGreaterThan((await operationsLineLead.boundingBox())!.y);

  const humanResources = page.locator(".company-role-executive-subtree").locator(".company-role-department-branch").filter({ has: page.getByRole("button", { name: /Human Resources.*3 people.*1 direct report/ }) });
  const humanResourcesButton = humanResources.getByRole("button", { name: /Human Resources.*3 people.*1 direct report/ });
  await expect(humanResourcesButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('.company-role-canvas .role-flowchart-line[data-source-id="company-cpo"][data-target-id="cpo-department-0"]')).toHaveCount(1);
  const managerBranch = humanResources.getByRole("button", { name: /Dana Manager.*Manager.*HR-MGR/ });
  await expect(managerBranch).toHaveAttribute("aria-expanded", "false");
  await expect(humanResources.getByText("Taylor Target")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await managerBranch.focus();
  await page.keyboard.press("Enter");
  const lineManagerBranch = humanResources.getByRole("button", { name: /Lina Lead.*Line Manager.*HR-LM/ });
  await expect(page.locator('.company-role-canvas .role-flowchart-line[data-source-id="reporting-hr-manager"][data-target-id="reporting-hr-line-manager"]')).toHaveCount(1);
  await lineManagerBranch.click();
  const target = humanResources.getByRole("button", { name: /Taylor Target.*Employee.*EMP-001/ });
  await expect(target).toBeVisible();
  await expect(target.getByText(/EMP-001.*HR Specialist/)).toBeVisible();
  await expect(target).toContainText("Reports toLina Lead");
  await expect(target.getByText("On leave")).toBeVisible();
  await expect(page.locator('.company-role-canvas .role-flowchart-line[data-source-id="reporting-hr-line-manager"][data-target-id="reporting-target-employee"]')).toHaveCount(1);
  await expect(page.locator('.company-role-canvas .role-flowchart-line[data-source-id="reporting-hr-line-manager"][data-target-id="reporting-target-employee"]')).toHaveClass(/direct-active/);
  await target.click();
  await expect(target).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("navigation", { name: "Selected reporting path" })).toContainText("Taylor Target");
  await expect(page.locator('.company-role-canvas .role-flowchart-line[data-source-id="reporting-hr-line-manager"][data-target-id="reporting-target-employee"]')).toHaveClass(/path-active/);
  expect(await target.evaluate(element => parseFloat(getComputedStyle(element.closest(".company-role-card-shell")!).animationDuration))).toBeLessThan(0.001);

  const search = page.getByPlaceholder("Find department, manager, or employee");
  await search.fill("Riley Report");
  await expect(operations.getByText("Riley Report")).toBeVisible();
  await expect(page.getByText("1 result", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Selected reporting path" })).toContainText("Operations");
  await expect(page.getByRole("button", { name: "Previous role hierarchy result" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next role hierarchy result" })).toBeVisible();
  await search.fill("");

  await search.fill("Manager");
  await expect(page.getByText("4 results", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Search result navigation" })).toContainText("1 of 4");
  await page.getByRole("button", { name: "Next role hierarchy result" }).click();
  await expect(page.getByRole("group", { name: "Search result navigation" })).toContainText("2 of 4");
  await search.fill("");

  await search.fill("CPO");
  await expect(page.getByText("1 result", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Selected reporting path" })).toContainText("CPO");
  await search.fill("Human Resources");
  await expect(page.getByText("1 result", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Selected reporting path" })).toContainText("Human Resources");
  await search.fill("");

  await page.getByLabel("View department").selectOption({ label: "Human Resources" });
  await expect(page.locator(".company-role-hierarchy")).toHaveClass(/company-role-hierarchy-focused/);
  await expect(page.getByLabel("View department")).toHaveValue(/cpo-department-/);
  await expect(page.getByRole("navigation", { name: "Selected reporting path" })).toContainText("COO");
  await expect(page.getByRole("navigation", { name: "Selected reporting path" })).toContainText("CPO");
  await page.getByLabel("View department").selectOption("");
  await expect(page.locator(".company-role-hierarchy")).not.toHaveClass(/company-role-hierarchy-focused/);

  await page.getByRole("button", { name: "Expand all" }).click();
  for (let step = 0; step < 5; step += 1) await page.getByRole("button", { name: "Zoom in role hierarchy" }).click();
  await expect(zoomValue).toHaveText("150%");
  await expect.poll(() => flowViewport.evaluate(element => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)).toBe(true);
  await flowViewport.evaluate(element => {
    element.scrollTo({ left: 0, top: 0 });
    const dispatch = (type: string, clientX: number, clientY: number) => element.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 42, pointerType: "mouse", clientX, clientY }));
    dispatch("pointerdown", 300, 260);
    dispatch("pointermove", 160, 160);
    dispatch("pointerup", 160, 160);
  });
  await expect.poll(() => flowViewport.evaluate(element => element.scrollLeft > 0 || element.scrollTop > 0)).toBe(true);
  await page.getByRole("button", { name: "Fit role hierarchy in view" }).click();
  await expect.poll(async () => Number((await zoomValue.textContent())?.replace("%", ""))).toBeLessThanOrEqual(100);
  await page.getByRole("button", { name: "Reset role hierarchy view" }).click();
  await expect(zoomValue).toHaveText("100%");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(flowViewport).toBeVisible();
  await expect.poll(() => flowViewport.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
  await expect(flowViewport).toHaveCSS("overflow-y", "visible");
  await expect(page.locator(".company-role-canvas")).toHaveCSS("position", "relative");
  await expect(canvasControls).toBeHidden();
  await expect(page.locator(".company-role-departments").first()).toHaveCSS("display", "grid");
  await expect(operations.locator(".company-role-cards")).toHaveCSS("display", "grid");
  await expect(page.locator(".company-role-canvas .role-flowchart-connectors")).toBeHidden();
  const mobileDirectReportBoxes = await Promise.all([operationsLineLead, operationsFieldReport, operationsReport].map(locator => locator.boundingBox()));
  expect(Math.max(...mobileDirectReportBoxes.map(box => box!.x)) - Math.min(...mobileDirectReportBoxes.map(box => box!.x))).toBeLessThan(3);
  expect(new Set(mobileDirectReportBoxes.map(box => Math.round(box!.y))).size).toBe(3);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.getByLabel("Switch to dark mode").click();
  await expect(target.getByText("Taylor Target")).toBeVisible();
  await expect.poll(() => flowViewport.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(21, 34, 56)");
  await page.getByLabel("Switch to light mode").click();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  expect((await download).suggestedFilename()).toBe("Company-Role-Hierarchy.pdf");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await organizationTab.click();
  await expect(page.locator(".organization-chart")).toBeVisible();
  await expect(page.getByRole("group", { name: "Company role hierarchy" })).toHaveCount(0);
});

test("Sidebar surfaces follow the selected theme", async ({ page }) => {
  await installSystemApi(page);
  await page.goto("/");
  await page.getByLabel("Email").fill("super.admin@example.invalid");
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  const color = (selector: string, property: "backgroundColor" | "color" | "backgroundImage") => page.locator(selector).evaluate((element, propertyName) => getComputedStyle(element)[propertyName], property);
  await expect.poll(() => color(".sidebar", "backgroundColor")).toBe("rgb(255, 255, 255)");
  await expect.poll(() => color(".account-trigger", "backgroundColor")).toBe("rgb(248, 250, 252)");
  await expect.poll(() => color(".logo-crop.wordmark", "backgroundColor")).toBe("rgba(0, 0, 0, 0)");

  await page.getByLabel("Switch to dark mode").click();
  await expect.poll(() => color(".sidebar", "backgroundImage")).toContain("linear-gradient");
  await expect.poll(() => color(".account-trigger", "color")).toBe("rgb(255, 255, 255)");
});

test("Super Admin System controls submit mutations and protect invalid actions", async ({ page }) => {
  await loginAndOpenSystem(page);
  await expect(page.getByRole("button", { name: "Create user" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Revoke all" })).toBeEnabled();
  await expect(page.getByRole("row", { name: /super\.admin@example\.invalid.*Current user/ })).toBeVisible();
  const searched = page.waitForRequest(request => request.url().includes("/api/v1/system/sessions?") && request.url().includes("search=target"));
  await page.getByLabel("Email search").fill("target");
  await searched;
  await expect(page.getByRole("row", { name: /target@example\.invalid/ })).toBeVisible();
  await page.getByRole("button", { name: "Disable" }).click();
  const statusDialog = page.getByRole("dialog");
  await statusDialog.getByLabel("Reason").fill("System UI status regression");
  await statusDialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Account status updated.")).toBeVisible();

  await page.getByRole("button", { name: "Access" }).click();
  const accessDialog = page.getByRole("dialog");
  await accessDialog.getByLabel("Permission").selectOption("permission-department-read");
  await accessDialog.getByLabel("Reason").fill("System UI access regression");
  await accessDialog.getByRole("button", { name: "Add override" }).click();
  await expect(page.getByText("Permission override created. Existing sessions were revoked.")).toBeVisible();

  await page.getByLabel("Delegator").selectOption("target-user");
  await page.getByLabel("Delegate").selectOption("admin-user");
  await page.getByLabel("Starts").fill("2030-01-01T09:00");
  await page.getByLabel("Ends").fill("2030-01-01T17:00");
  await page.getByLabel("Reason").last().fill("System UI delegation regression");
  const createdDelegation = page.waitForResponse(response => response.url().endsWith("/api/v1/system/delegations") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create delegation" }).click();
  expect((await createdDelegation).status()).toBe(201);
  await expect(page.getByText("target@example.invalid → super.admin@example.invalid")).toBeVisible();
});

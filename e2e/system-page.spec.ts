import { expect, test, type Page } from "@playwright/test";

type User = { id: string; email: string; isActive: boolean; localLoginEnabled: boolean; microsoftLoginEnabled: boolean; authorizationVersion: number; roles: Array<{ role: Role }>; permissionOverrides: unknown[] };
type Role = { id: string; code: string; displayName: string; description?: string; version: number; isBuiltIn: boolean; isActive: boolean; protection: "STANDARD" | "PROTECTED" | "SUPER_ADMIN"; inherits: string[]; permissions?: Array<{ permission: Permission }> };
type Permission = { id: string; code: string; displayName: string; category: string; isProtected: boolean; isDeprecated: boolean };

const permissions: Permission[] = [
  { id: "permission-department-read", code: "department.read", displayName: "Read departments", category: "Organization", isProtected: false, isDeprecated: false },
  { id: "permission-role-protected", code: "role.assign_protected", displayName: "Assign protected roles", category: "System", isProtected: true, isDeprecated: false },
];
const roles: Role[] = [
  { id: "role-employee", code: "EMPLOYEE", displayName: "Employee", version: 1, isBuiltIn: true, isActive: true, protection: "STANDARD", inherits: [], permissions: [] },
  { id: "role-hr", code: "HR", displayName: "HR", version: 1, isBuiltIn: true, isActive: true, protection: "STANDARD", inherits: ["EMPLOYEE"], permissions: [] },
  { id: "role-super-admin", code: "SUPER_ADMIN", displayName: "Super Administrator", version: 1, isBuiltIn: true, isActive: true, protection: "SUPER_ADMIN", inherits: ["EMPLOYEE", "HR"], permissions: [] },
  { id: "role-custom", code: "CUSTOM_VIEWER", displayName: "Custom Viewer", version: 1, isBuiltIn: false, isActive: true, protection: "STANDARD", inherits: [], permissions: [] },
];

function envelope(data: unknown, meta?: unknown) {
  return { success: true, data, ...(meta === undefined ? {} : { meta }) };
}

async function installSystemApi(page: Page, sessionRoles = ["SUPER_ADMIN"], userCount = 2) {
  const admin = { id: "admin-user", email: "super.admin@example.invalid", displayName: "Super Admin", roles: sessionRoles, permissions: ["session.self.read", "user.read", "user.manage", "permission.assign", "role.assign", "user.deactivate", "user.delete_soft", "role.read", "role.manage", "permission.read", "session.manage", "workflow.policy.read", "workflow.policy.manage", "workflow.delegation.read", "workflow.delegation.manage"], departmentScopeIds: [], sessionId: "admin-session", authProvider: "local", authorizationVersion: 1, employeeId: "admin-employee" };
  const target: User = { id: "target-user", email: "target@example.invalid", isActive: true, localLoginEnabled: true, microsoftLoginEnabled: false, authorizationVersion: 1, roles: [{ role: roles[1] }], permissionOverrides: [] };
  const users: User[] = [{ ...target }, { id: admin.id, email: admin.email, isActive: true, localLoginEnabled: true, microsoftLoginEnabled: false, authorizationVersion: 1, roles: [{ role: roles[2] }], permissionOverrides: [] }];
  users.push(...Array.from({ length: Math.max(0, userCount - users.length) }, (_, index) => ({ id: `user-${index + 1}`, email: `user-${index + 1}@example.invalid`, isActive: true, localLoginEnabled: true, microsoftLoginEnabled: false, authorizationVersion: 1, roles: [{ role: roles[1] }], permissionOverrides: [] })));
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
  const created = page.waitForRequest(request => request.url().endsWith("/api/v1/system/users") && request.method() === "POST");
  await page.getByRole("button", { name: "Create user" }).click();
  const payload = JSON.parse((await created).postData() || "{}");
  expect(payload).toMatchObject({ localLoginEnabled: true, microsoftLoginEnabled: false, email: "local.user@example.invalid" });
  await expect(page.getByText("Login user created.")).toBeVisible();
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
  await page.goto("/hierarchy");
  await expect(page.getByRole("heading", { name: "Access not available" })).toBeVisible();
});

test("Admin can edit custom-role inheritance", async ({ page }) => {
  await installSystemApi(page, ["ADMIN"]);
  await page.goto("/");
  await page.getByLabel("Email").fill("super.admin@example.invalid");
  await page.getByLabel("Password").fill("IntegrationPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Hierarchy" }).click();
  await page.getByRole("button", { name: "Edit hierarchy" }).click();
  await expect(page.getByRole("heading", { name: "Edit Custom Viewer hierarchy" })).toBeVisible();
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
  await expect(page.getByRole("group", { name: "Role hierarchy filter" })).toHaveCount(0);
  await page.getByRole("link", { name: "Hierarchy" }).click();
  await expect(page.getByRole("heading", { name: "Role hierarchy" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Role hierarchy filter" })).toBeVisible();
  await page.getByRole("button", { name: "Edit hierarchy" }).click();
  await expect(page.getByRole("heading", { name: "Edit Custom Viewer hierarchy" })).toBeVisible();
  await page.getByRole("checkbox", { name: "HR", exact: true }).check();
  await page.getByLabel("Reason").fill("Custom role needs HR visibility");
  const hierarchySaved = page.waitForRequest(request => request.url().endsWith("/api/v1/system/roles/role-custom/inheritance") && request.method() === "PUT");
  await page.getByRole("button", { name: "Save hierarchy" }).click();
  expect(JSON.parse((await hierarchySaved).postData() || "{}")).toMatchObject({ parentRoleIds: ["role-hr"], expectedVersion: 1, reason: "Custom role needs HR visibility" });
  await expect(page.getByText("Role inheritance updated. Affected sessions were revoked.")).toBeVisible();
  const roleFiltered = page.waitForRequest(request => request.url().includes("/api/v1/system/users?") && request.url().includes("roleId=role-hr"));
  await page.getByRole("button", { name: "Filter users by HR role" }).click();
  await roleFiltered;
  await expect(page.getByRole("row", { name: /target@example\.invalid/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /super\.admin@example\.invalid/ })).not.toBeVisible();
  const combinedFilter = page.waitForRequest(request => request.url().includes("roleId=role-hr") && request.url().includes("search=target"));
  await page.getByLabel("Find users").fill("target");
  await combinedFilter;
  await expect(page.getByText("1 user found with HR.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("link", { name: "System" }).click();
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
  await page.getByRole("button", { name: "Create delegation" }).click();
  await expect(page.getByText("Workflow delegation created.")).toBeVisible();
});

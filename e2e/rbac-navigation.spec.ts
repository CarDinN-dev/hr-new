import { expect, test, type Page } from "@playwright/test";
import { navPaths } from "../src/routing";

type SessionOverride = {
  roles: string[];
  permissions: string[];
  employeeId?: string;
};

const baseSession = {
  id: "rbac-ui-user",
  email: "rbac.ui@example.invalid",
  displayName: "RBAC UI User",
  csrfToken: "csrf-token",
  departmentScopeIds: [],
  sessionId: "rbac-ui-session",
  authProvider: "local",
  authorizationVersion: 1,
  employeeId: "employee-1",
};

async function installSession(page: Page, override: SessionOverride) {
  const activeSession = { ...baseSession, ...override };
  await page.addInitScript(({ key, value }) => {
    sessionStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem("medtech-hr-theme", "light");
  }, { key: "medtech-hr-erp-backend-session-v2", value: activeSession });

  await page.route("**/api/v1/**", route => {
    const pathname = new URL(route.request().url()).pathname;
    const data = pathname === "/api/v1/auth/me"
      ? { csrfToken: activeSession.csrfToken, user: activeSession }
      : pathname === "/api/v1/employees/me"
        ? {
            id: "employee-1",
            employeeCode: "MTC001",
            firstName: "RBAC",
            lastName: "User",
            email: "rbac.ui@example.invalid",
            hireDate: "2024-01-01",
            employmentStatus: "ACTIVE",
          }
        : pathname === "/api/v1/attendance/reports/summary"
          ? {
              summary: {
                totalRecords: 0,
                byStatus: { PRESENT: 0, HALF_DAY: 0, LEAVE: 0, ABSENT: 0, LATE: 0 },
              },
            }
          : pathname === "/api/v1/approvals/inbox"
            ? { leave: [], certificates: [], payroll: [] }
            : [];

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data,
        meta: { total: Array.isArray(data) ? data.length : 0, page: 1, limit: 100, totalPages: 1 },
      }),
    });
  });
}

test("employee can open own payslips but cannot see or deep-link to attendance", async ({ page }) => {
  await installSession(page, {
    roles: ["EMPLOYEE"],
    permissions: [
      "session.self.read",
      "employee.self.read",
      "leave.self.read",
      "service_request.self.read",
      "payroll.self.read_payslip",
    ],
  });

  await page.goto(navPaths.Dashboard);
  await expect(page.getByRole("link", { name: "Payroll" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Attendance" })).toHaveCount(0);

  await page.goto(navPaths.Payroll);
  await expect(page.locator(".content")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Access not available" })).toHaveCount(0);

  await page.goto(navPaths.Attendance);
  await expect(page.getByRole("heading", { name: "Access not available" })).toBeVisible();
});

for (const role of ["LINE_MANAGER", "MANAGER"] as const) {
  test(`${role} cannot regain attendance through legacy permissions`, async ({ page }) => {
    await installSession(page, {
      roles: [role],
      permissions: [
        "session.self.read",
        "employee.self.read",
        role === "LINE_MANAGER" ? "attendance.team.read" : "attendance.management.read",
      ],
    });

    await page.goto(navPaths.Dashboard);
    await expect(page.getByRole("link", { name: "Attendance" })).toHaveCount(0);
    await page.goto(navPaths.Attendance);
    await expect(page.getByRole("heading", { name: "Access not available" })).toBeVisible();
  });
}

test("HR retains attendance navigation and direct route access", async ({ page }) => {
  await installSession(page, {
    roles: ["HR"],
    permissions: ["session.self.read", "employee.hr.read", "attendance.hr.read"],
  });

  await page.goto(navPaths.Dashboard);
  await expect(page.getByRole("link", { name: "Attendance" })).toBeVisible();
  await page.goto(navPaths.Attendance);
  await expect(page.locator(".content")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Access not available" })).toHaveCount(0);
});

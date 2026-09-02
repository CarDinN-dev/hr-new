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

async function installUiApi(page: Page, employees: unknown[] = [], extraPermissions: string[] = [], initialTheme: "light" | "dark" = "light", sessionOverride: Partial<typeof session> = {}) {
  const testSession = { ...session, ...sessionOverride, permissions: [...(sessionOverride.permissions || session.permissions), ...extraPermissions] };
  const { csrfToken, ...user } = testSession;
  await page.addInitScript(({ value, theme }) => {
    sessionStorage.setItem("medtech-hr-erp-backend-session-v2", JSON.stringify(value));
    localStorage.setItem("medtech-hr-theme", theme);
  }, { value: testSession, theme: initialTheme });
  await page.route("**/api/v1/**", route => {
    const pathname = new URL(route.request().url()).pathname;
    const data = pathname === "/api/v1/auth/me" ? { csrfToken, user }
      : pathname === "/api/v1/employees/me" ? employees[0] ?? { id: "employee-1", employeeCode: "MTC001", firstName: "UI", lastName: "Admin", email: "ui.admin@example.invalid", hireDate: "2020-01-01", employmentStatus: "ACTIVE" }
      : pathname === "/api/v1/employees" ? employees
      : pathname === "/api/v1/notifications" ? [{ id: "notification-1", type: "TEST", title: "Test notification", message: "Visible notification content", createdAt: "2026-08-11T08:00:00.000Z", readAt: null }]
      : pathname === "/api/v1/approvals/inbox" ? { leave: [], certificates: [], payroll: [] }
      : pathname === "/api/v1/attendance/reports/summary" ? { summary: { totalRecords: 6, byStatus: { PRESENT: 5, LATE: 1, ABSENT: 0 } } }
      : pathname === "/api/v1/payroll/preflight" ? { ready: true, runType: "REGULAR", policy: { prorationBasis: "CALENDAR_DAYS", requireBankDetails: false, requireAttendance: false, varianceThreshold: "0" }, summary: { employees: 0, errors: 0, warnings: 0, grossPay: "0", deductions: "0", netPay: "0", adjustments: 0 }, issues: [] }
      : [];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data, meta: { total: Array.isArray(data) ? data.length : 0, page: 1, limit: 100, totalPages: 1, unread: pathname === "/api/v1/notifications" ? 1 : undefined } })
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
  await expect(page.getByRole("link", { name: "Business Trips" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Expenses" })).toHaveCount(1);
});

test("employees only see Team and not directory or personal finance routes", async ({ page }) => {
  await installUiApi(page, [], [], "light", {
    roles: ["EMPLOYEE"],
    permissions: ["session.self.read", "employee.self.read", "trip.self.read", "expense.self.read", "loan.self.read"],
  });

  await page.goto(navPaths.Dashboard);
  await expect(page.getByRole("link", { name: "Team" })).toBeVisible();
  for (const route of ["Employees", "Business Trips", "Expenses", "Loans"] as const) {
    await expect(page.getByRole("link", { name: route })).toHaveCount(0);
    await page.goto(navPaths[route]);
    await expect(page.getByRole("heading", { name: "Access not available" })).toBeVisible();
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`all application routes use the canonical ${theme} surfaces`, async ({ page }) => {
    test.setTimeout(60_000);
    await installUiApi(page, [], [], theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    const expected = theme === "light"
      ? { canvas: "#f3f6fa", surface: "rgb(255, 255, 255)", body: "rgb(243, 246, 250)" }
      : { canvas: "#08111f", surface: "rgb(15, 27, 45)", body: "rgb(8, 17, 31)" };

    for (const [name, path] of Object.entries(navPaths)) {
      await test.step(name, async () => {
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.locator(".content")).toBeVisible();
        await expect(page.getByRole("search")).toHaveCount(1);
        if (theme === "dark" && name === "Dashboard") {
          await expect(page.locator(".dashboard-attendance-summary strong").first()).toBeVisible();
        }
        const colors = await page.evaluate(() => {
          const root = getComputedStyle(document.documentElement);
          const firstSurface = document.querySelector<HTMLElement>(".content :is(.panel, .metric, .report-card, .employee-card, .payroll-tile):not(.hero-panel)");
          return {
            canvas: root.getPropertyValue("--canvas").trim().toLowerCase(),
            body: getComputedStyle(document.body).backgroundColor,
            workspace: getComputedStyle(document.querySelector<HTMLElement>(".workspace")!).backgroundColor,
            search: getComputedStyle(document.querySelector<HTMLElement>('[role="search"]')!).backgroundColor,
            surface: firstSurface ? getComputedStyle(firstSurface).backgroundColor : null,
            dashboardValue: document.querySelector<HTMLElement>(".dashboard-attendance-summary strong")
              ? getComputedStyle(document.querySelector<HTMLElement>(".dashboard-attendance-summary strong")!).color
              : null,
          };
        });
        expect(colors.canvas).toBe(expected.canvas);
        expect(colors.body).toBe(expected.body);
        if (theme === "light") expect(colors.workspace).toBe(expected.body);
        expect(colors.search).toBe(expected.surface);
        if (colors.surface) expect(colors.surface).toBe(expected.surface);
        if (theme === "dark" && name === "Dashboard") expect(colors.dashboardValue).toBe("rgb(238, 244, 252)");
        await expect(page.locator(".mobile-menu")).toBeHidden();
        await expect(page.locator(".sidebar-close")).toBeHidden();
      });
    }
  });
}

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1152, height: 768 },
  { width: 1024, height: 768 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
] as const) {
  test(`all application routes retain aligned clinical geometry at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(60_000);
    await installUiApi(page);
    await page.setViewportSize(viewport);
    for (const [name, path] of Object.entries(navPaths)) {
      await test.step(`${name} at ${viewport.width}px`, async () => {
        await page.goto(path);
        await expect(page.locator(".content")).toBeVisible();
        const pageOverflow = await page.evaluate(() => ({
          fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          width: document.documentElement.scrollWidth,
          viewport: document.documentElement.clientWidth,
          offenders: [...document.querySelectorAll<HTMLElement>("body *")]
            .filter(element => {
              const rect = element.getBoundingClientRect();
              return rect.width > 0 && rect.right > document.documentElement.clientWidth + 1;
            })
            .slice(0, 8)
            .map(element => ({ className: element.className, right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) })),
        }));
        expect(pageOverflow.fits, JSON.stringify(pageOverflow)).toBe(true);
        expect(pageOverflow.width).toBe(pageOverflow.viewport);

        const content = await page.evaluate(() => {
          const element = document.querySelector(".content");
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return { x: rect.x, width: rect.width };
        });
        expect(content).not.toBeNull();
        expect(content!.x).toBeGreaterThanOrEqual(0);
        expect(content!.x + content!.width).toBeLessThanOrEqual(viewport.width + 1);

        const search = page.getByRole("search");
        await expect(search).toHaveCount(1);
        const searchBox = await search.boundingBox();
        expect(searchBox).not.toBeNull();
        expect(searchBox!.height).toBe(44);
        expect(searchBox!.x).toBeGreaterThanOrEqual(0);
        expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(viewport.width + 1);
        if (name !== "Employees") {
          const actions = await page.locator(".topbar-actions").boundingBox();
          expect(actions).not.toBeNull();
          if (viewport.width <= 1023) expect(actions!.y + actions!.height).toBeLessThanOrEqual(searchBox!.y);
          else expect(Math.abs(actions!.y + actions!.height / 2 - searchBox!.y - searchBox!.height / 2)).toBeLessThanOrEqual(4);
        }

        const firstSurface = page.locator(".panel, .metric, .report-card, .employee-card, .payroll-tile").first();
        if (await firstSurface.count()) {
          const surface = await firstSurface.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return { x: rect.x, width: rect.width, borderRadius: getComputedStyle(element).borderRadius };
          });
          expect(surface).not.toBeNull();
          expect(surface!.x).toBeGreaterThanOrEqual(0);
          expect(surface!.x + surface!.width).toBeLessThanOrEqual(viewport.width + 1);
          expect(surface!.borderRadius).toBe("16px");
        }
      });
    }

    if (viewport.width === 1440) {
      await page.goto(navPaths.Recruitment);
      const pipeline = page.locator(".recruitment-pipeline");
      await expect(pipeline).toBeVisible();
      expect(await pipeline.evaluate(element => element.scrollWidth >= element.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  });
}

test("mobile dashboard, wide tables and shared dialog retain usable geometry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installUiApi(page);
  await page.goto("/");

  const hero = await page.locator(".hero-copy").boundingBox();
  const heading = await page.getByRole("heading", { name: /^(Good morning|Good afternoon|Good evening), UI Admin/ }).boundingBox();
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
  await expect(page.getByLabel("Access role", { exact: true })).toBeVisible();
  const employeeEditor = await page.locator(".modal:has(> .employee-editor)").boundingBox();
  expect(employeeEditor).not.toBeNull();
  expect(employeeEditor!.x + employeeEditor!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveClass(/is-closing/);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(addEmployee).toBeFocused();

  await page.goto("/system");
  const table = page.locator(".table-wrap:has(th:nth-child(4))").first();
  await expect(table).toBeVisible();
  expect(await table.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByText("Scroll horizontally for more columns")).toHaveCount(0);
});

test("clinical tokens, dashboard bento, themes and reduced motion stay responsive", async ({ page }) => {
  await installUiApi(page);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await test.step(`${viewport.width}x${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await page.goto("/");

      const tokens = await page.evaluate(() => {
        const styles = getComputedStyle(document.documentElement);
        return ["--brand-red", "--brand-plum", "--brand-navy"].map(token => styles.getPropertyValue(token).trim().toLowerCase());
      });
      expect(tokens).toEqual(["#ed1e36", "#832951", "#23326a"]);
      await expect(page.locator(".dashboard-layout")).toHaveCSS("display", "grid");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

      const [hero, metrics] = await Promise.all([
        page.locator(".hero-panel").boundingBox(),
        page.locator(".metric-grid").boundingBox()
      ]);
      expect(hero).not.toBeNull();
      expect(metrics).not.toBeNull();
      if (viewport.width > 1200) expect(Math.abs(hero!.y - metrics!.y)).toBeLessThanOrEqual(2);
      else expect(metrics!.y).toBeGreaterThan(hero!.y + hero!.height - 2);
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const logo = page.locator(".brand-block img");
  expect(await logo.evaluate(image => ({ source: (image as HTMLImageElement).getAttribute("src"), width: (image as HTMLImageElement).naturalWidth, transform: getComputedStyle(image).transform }))).toEqual({ source: "/logos/medtech-logo-page-2.svg", width: 840, transform: "none" });
  const sidebarLogo = await page.locator(".logo-crop.wordmark").boundingBox();
  expect(sidebarLogo).toMatchObject({ width: 212, height: 56 });
  await expect(page.locator(".logo-crop.wordmark")).toHaveCSS("background-color", "rgb(247, 248, 252)");
  await expect(logo).toHaveAttribute("alt", "MedTech Corporation Trading W.L.L.");
  await expect(page.locator(".mobile-menu")).toBeHidden();
  await expect(page.locator(".sidebar-close")).toBeHidden();

  const primaryColors = await page.getByRole("button", { name: "Add employee" }).evaluate(element => ({
    background: getComputedStyle(element).backgroundColor,
    color: getComputedStyle(element).color,
    height: element.getBoundingClientRect().height,
  }));
  expect(primaryColors).toMatchObject({ background: "rgb(248, 250, 252)", color: "rgb(35, 50, 106)" });
  expect(primaryColors.height).toBeCloseTo(42, 3);
  const lightPanel = await page.locator(".panel").first().evaluate(element => getComputedStyle(element).backgroundColor);
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const darkPanel = await page.locator(".panel").first().evaluate(element => getComputedStyle(element).backgroundColor);
  expect(darkPanel).not.toBe(lightPanel);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const transitionSeconds = await page.getByRole("button", { name: "Add employee" }).evaluate(element => parseFloat(getComputedStyle(element).transitionDuration));
  expect(transitionSeconds).toBeLessThanOrEqual(.001);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const mobileHeaderLogo = await page.locator(".topbar-brand-mark").boundingBox();
  expect(mobileHeaderLogo).toMatchObject({ width: 60, height: 48 });
  await expect(page.locator(".topbar-brand-mark img")).toHaveAttribute("src", "/logos/medtech-logo-page-2.svg");
  await expect(page.locator(".topbar-brand-mark")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const darkDashboardColors = await page.evaluate(() => {
    const snapshot = document.querySelector<HTMLElement>(".dashboard-snapshot")!;
    return { heading: getComputedStyle(document.querySelector<HTMLElement>(".hero-panel h2")!).color, snapshot: getComputedStyle(snapshot).color, surface: getComputedStyle(snapshot).backgroundColor };
  });
  expect(darkDashboardColors.heading).toBe(darkDashboardColors.snapshot);
  expect(darkDashboardColors.surface).not.toBe("rgba(0, 0, 0, 0)");
});

test("dashboard composition and leave workspace use aligned semantic surfaces", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installUiApi(page, [{
    id: "employee-1", employeeCode: "MTC001", firstName: "Dashboard", lastName: "Employee",
    email: "dashboard.employee@example.invalid", hireDate: "2020-01-01", employmentStatus: "ACTIVE",
    department: { id: "department-1", name: "Human Resources", code: "HR" }, position: { title: "HR Specialist", code: "HR-SPEC" },
  }], ["leave.self.create"]);
  await page.goto("/");
  await expect(page.locator(".hero-panel")).toBeVisible();
  await expect(page.locator(".headcount-chart svg")).toBeVisible();

  const dashboardSurfaces = await page.evaluate(() => {
    return {
      hero: getComputedStyle(document.querySelector<HTMLElement>(".hero-panel")!).backgroundColor,
      surface: getComputedStyle(document.querySelector<HTMLElement>(".metric")!).backgroundColor,
    };
  });
  expect(dashboardSurfaces.hero).toBe(dashboardSurfaces.surface);
  await expect(page.locator(".headcount-ranking")).toContainText("Human Resources");

  await page.goto("/leave");
  await expect(page.locator(".leave-request-panel")).toBeVisible();
  const [balance, request] = await Promise.all([
    page.locator(".leave-balance-panel").boundingBox(),
    page.locator(".leave-request-panel").boundingBox(),
  ]);
  expect(balance).not.toBeNull();
  expect(request).not.toBeNull();
  expect(Math.abs(balance!.y - request!.y)).toBeLessThanOrEqual(1);
  expect(request!.height).toBeGreaterThan(balance!.height);
  await expect(page.locator(".leave-balance-panel .leave-balance-grid")).not.toHaveCSS("overflow-y", "auto");
});

const roleDashboardEmployee = {
  id: "employee-1", employeeCode: "MTC001", firstName: "Role", lastName: "Fixture",
  email: "ui.admin@example.invalid", hireDate: "2020-01-01", employmentStatus: "ACTIVE",
  department: { id: "department-1", name: "Human Resources", code: "HR" }, position: { title: "HR Specialist", code: "HR-SPEC" },
};

const roleDashboardCases = [
  { name: "Employee", persona: "employee", heading: "My leave balance", roles: ["EMPLOYEE"], permissions: ["session.self.read", "employee.self.read", "leave.self.read", "leave.self.create", "document.self.read", "announcement.read", "service_request.self.read", "service_request.self.create"], attendance: false, payroll: false },
  { name: "Line Manager", persona: "line-manager", heading: "Team snapshot", roles: ["LINE_MANAGER"], permissions: ["session.self.read", "employee.self.read", "employee.team.read", "leave.self.read", "leave.team.read", "leave.team.approve_line_manager", "document.self.read"], attendance: false, payroll: false },
  { name: "Manager", persona: "manager", heading: "Recent scoped leave activity", roles: ["MANAGER"], permissions: ["session.self.read", "employee.self.read", "employee.management.read", "leave.self.read", "leave.management.read", "leave.management.approve_manager", "document.self.read"], attendance: false, payroll: false },
  { name: "HR", persona: "hr", heading: "Operational focus", roles: ["HR"], permissions: ["session.self.read", "employee.self.read", "employee.hr.read", "employee.hr.create", "leave.self.read", "leave.self.create", "leave.hr.read", "leave.hr.approve", "attendance.hr.read", "payroll.read", "recruitment.read", "document.hr.read"], attendance: true, payroll: true },
  { name: "CPO", persona: "cpo", heading: "Recruitment outlook", roles: ["CPO"], permissions: ["session.self.read", "employee.self.read", "employee.read_all", "leave.self.read", "leave.read_all", "leave.executive.approve_cpo", "attendance.read_all", "recruitment.read", "document.self.read"], attendance: true, payroll: false },
  { name: "COO", persona: "coo", heading: "Organization leave outlook", roles: ["COO"], permissions: ["session.self.read", "employee.self.read", "employee.read_all", "leave.self.read", "leave.read_all", "leave.executive.approve_coo", "attendance.read_all", "document.self.read"], attendance: true, payroll: false },
  { name: "Admin", persona: "hr", heading: "Operational focus", roles: ["ADMIN"], permissions: ["session.self.read", "employee.self.read", "employee.hr.read", "leave.self.read", "leave.hr.read", "leave.hr.approve", "attendance.hr.read", "payroll.read"], attendance: true, payroll: false },
  { name: "Super Admin", persona: "hr", heading: "Operational focus", roles: ["SUPER_ADMIN"], permissions: ["session.self.read", "employee.self.read", "employee.read_all", "leave.self.read", "leave.read_all", "leave.hr.approve", "attendance.read_all", "payroll.read"], attendance: true, payroll: true },
] as const;

const personaOnlyHeadings = ["My leave balance", "Team snapshot", "Recent scoped leave activity", "Operational focus", "Recruitment outlook", "Organization leave outlook"] as const;

for (const roleCase of roleDashboardCases) {
  test(`${roleCase.name} receives only its role-safe dashboard requests`, async ({ page }) => {
    const requests: string[] = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/v1/")) requests.push(`${url.pathname}${url.search}`);
    });
    await installUiApi(page, [roleDashboardEmployee], [], "light", { roles: [...roleCase.roles], permissions: [...roleCase.permissions] });
    await page.goto(navPaths.Dashboard);

    await expect(page.locator(".dashboard-layout")).toHaveAttribute("data-dashboard-persona", roleCase.persona);
    await expect(page.getByRole("heading", { name: roleCase.heading })).toBeVisible();
    for (const heading of personaOnlyHeadings.filter(heading => heading !== roleCase.heading)) {
      await expect(page.getByRole("heading", { name: heading })).toHaveCount(0);
    }
    await page.waitForLoadState("networkidle");
    expect(requests.some(path => path.startsWith("/api/v1/attendance/reports/summary"))).toBe(roleCase.attendance);
    expect(requests.some(path => path.startsWith("/api/v1/payroll/runs"))).toBe(roleCase.payroll);
    expect(requests.some(path => path.startsWith("/api/v1/approvals/inbox"))).toBe(roleCase.persona !== "employee");
  });
}

test("employee dashboard search never requests scoped employee or executive data", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1/")) requests.push(`${url.pathname}${url.search}`);
  });
  await installUiApi(page, [roleDashboardEmployee], [], "light", {
    roles: ["EMPLOYEE"],
    permissions: ["session.self.read", "employee.self.read", "leave.self.read", "document.self.read", "announcement.read", "service_request.self.read"],
  });
  await page.goto(navPaths.Dashboard);
  await page.getByRole("search").getByRole("searchbox").fill("Role");
  await page.waitForTimeout(350);
  expect(requests.some(path => path.startsWith("/api/v1/employees?"))).toBe(false);
  expect(requests.some(path => path.startsWith("/api/v1/attendance/reports/summary"))).toBe(false);
  expect(requests.some(path => path.startsWith("/api/v1/payroll/runs"))).toBe(false);
  expect(requests.some(path => path.startsWith("/api/v1/approvals/inbox"))).toBe(false);
});

test("multi-role dashboard precedence chooses the highest permitted persona", async ({ page }) => {
  await installUiApi(page, [roleDashboardEmployee], [], "light", {
    roles: ["EMPLOYEE", "HR", "CPO"],
    permissions: ["session.self.read", "employee.self.read", "employee.read_all", "leave.self.read", "leave.read_all", "leave.executive.approve_cpo", "attendance.read_all", "recruitment.read"],
  });
  await page.goto(navPaths.Dashboard);
  await expect(page.locator(".dashboard-layout")).toHaveAttribute("data-dashboard-persona", "cpo");
});

test("dashboard reuses the approval inbox actions", async ({ page }) => {
  const approvalRequests: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (request.method() === "POST") approvalRequests.push(url.pathname);
  });
  await installUiApi(page, [roleDashboardEmployee], ["leave.hr.approve"]);
  await page.route("**/api/v1/approvals/inbox", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data: { leave: [{ id: "leave-1", employee: { firstName: "Team", lastName: "Member" }, leaveType: { name: "Annual leave" }, currentStage: "HR", startDate: "2026-08-20", endDate: "2026-08-20", totalDays: "1", version: 1 }], certificates: [], payroll: [] } }),
  }));
  await page.goto(navPaths.Dashboard);
  await expect(page.getByRole("heading", { name: "Approval inbox" })).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect.poll(() => approvalRequests).toContain("/api/v1/leave/leave-1/approve");
});

test("dashboard actions retain their existing destinations", async ({ page }) => {
  await installUiApi(page, [roleDashboardEmployee], ["leave.self.create"]);
  await page.goto(navPaths.Dashboard);
  await page.getByRole("button", { name: "Apply leave" }).click();
  await expect(page).toHaveURL(navPaths.Leave);
  await page.goto(navPaths.Dashboard);
  await page.getByRole("button", { name: "My profile" }).click();
  await expect(page).toHaveURL(navPaths["My HR"]);
  await page.goto(navPaths.Dashboard);
  await page.getByRole("button", { name: /Run payroll|View payroll/ }).click();
  await expect(page).toHaveURL(navPaths.Payroll);
  await page.goto(navPaths.Dashboard);
  await page.getByRole("button", { name: "View employees" }).click();
  await expect(page).toHaveURL(navPaths.Employees);
  await page.goto(navPaths.Dashboard);
  await page.getByRole("button", { name: "View attendance" }).click();
  await expect(page).toHaveURL(navPaths.Attendance);
});

test("employee dashboard certificate action retains the documents destination", async ({ page }) => {
  await installUiApi(page, [roleDashboardEmployee], [], "light", { roles: ["EMPLOYEE"], permissions: ["session.self.read", "employee.self.read", "leave.self.read", "leave.self.create", "document.self.read", "service_request.self.read"] });
  await page.goto(navPaths.Dashboard);
  await page.getByRole("button", { name: "Request certificate" }).click();
  await expect(page).toHaveURL(navPaths.Documents);
});

test("navigation rail and drawer keep their controls reachable across the 1023px breakpoint", async ({ page }) => {
  await installUiApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const sidebar = page.locator("#main-navigation");
  const desktopToggle = page.getByRole("button", { name: "Collapse sidebar" });
  await expect(sidebar).toBeVisible();
  await expect(desktopToggle).toHaveCSS("width", "44px");
  await desktopToggle.click();
  await expect(sidebar).toHaveCSS("width", "76px");
  await expect(sidebar).not.toHaveAttribute("aria-hidden", "true");
  await expect(sidebar).not.toHaveAttribute("inert", "");
  await expect(sidebar.getByRole("link", { name: "My HR" })).toBeVisible();
  expect(await page.locator(".topbar-brand-mark").boundingBox()).toMatchObject({ width: 168, height: 46 });
  await sidebar.getByRole("link", { name: "My HR" }).click();
  await expect(page).toHaveURL(navPaths["My HR"]);
  await expect(sidebar.getByRole("link", { name: "Open Overview" })).toHaveCount(0);
  await sidebar.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page).toHaveURL(navPaths.Dashboard);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(sidebar).toBeVisible();

  await page.setViewportSize({ width: 1023, height: 720 });
  const menu = page.getByRole("button", { name: "Open menu" });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS("width", "44px");
  await expect(sidebar).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar).toBeVisible();
  await expect(page.locator(".scrim")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close navigation" })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.keyboard.press("Escape");
  await expect(page.locator(".scrim")).toHaveCount(0);
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

  await menu.click();
  await page.locator(".scrim").click();
  await expect(sidebar).toBeHidden();
  await menu.click();
  await expect(page.locator(".scrim")).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 720 });
  await expect(page.locator(".scrim")).toHaveCount(0);
  await expect(sidebar).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

  const themeButton = page.getByRole("button", { name: "Switch to dark mode" });
  await expect(themeButton).toHaveCSS("width", "44px");
  expect(await themeButton.evaluate(button => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === button || button.contains(hit);
  })).toBe(true);
  await themeButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".mobile-menu")).toBeHidden();
  await expect(page.locator(".sidebar-close")).toBeHidden();
});

test("desktop page frames stay centered through the animated sidebar collapse", async ({ page }) => {
  await installUiApi(page);
  await page.setViewportSize({ width: 1920, height: 1080 });

  for (const path of [navPaths.Dashboard, navPaths.Reports, navPaths.Settings]) {
    await page.goto(path);
    await expect(page.locator(".content")).toBeVisible();
    await expect(page.locator(".topbar-inner")).toBeVisible();
    const geometry = await page.evaluate(() => {
      const workspace = document.querySelector<HTMLElement>(".workspace")!.getBoundingClientRect();
      const content = document.querySelector<HTMLElement>(".content")!.getBoundingClientRect();
      const header = document.querySelector<HTMLElement>(".topbar-inner")!.getBoundingClientRect();
      return {
        contentWidth: content.width,
        contentOffset: Math.abs((content.left + content.width / 2) - (workspace.left + workspace.width / 2)),
        headerOffset: Math.abs((header.left + header.width / 2) - (workspace.left + workspace.width / 2)),
      };
    });
    expect(geometry.contentWidth).toBeCloseTo(1460, 0);
    expect(geometry.contentOffset).toBeLessThanOrEqual(1);
    expect(geometry.headerOffset).toBeLessThanOrEqual(1);
  }

  await page.goto(navPaths.Dashboard);
  await expect(page.locator(".content")).toBeVisible();
  const sidebar = page.locator("#main-navigation");
  const sidebarBrand = sidebar.locator(".sidebar-brand");
  const collapsedBrandMark = sidebar.locator(".logo-crop.wordmark");
  await expect(sidebarBrand).toHaveAttribute("aria-hidden", "true");
  await expect(sidebar.getByRole("link", { name: "Open Overview" })).toHaveCount(0);
  expect(await sidebarBrand.evaluate(element => (element as HTMLElement).tabIndex)).toBe(-1);
  await sidebarBrand.hover();
  await expect(sidebarBrand).toHaveCSS("justify-content", "flex-start");
  await expect(sidebarBrand).toHaveCSS("transform", "none");
  await expect(sidebarBrand).toHaveCSS("transition-duration", "0s");
  const expectExpandedBrandLockup = async () => {
    await expect(collapsedBrandMark.locator("img")).toHaveAttribute("src", "/logos/medtech-lockup.svg?v=4");
    await expect(collapsedBrandMark).toHaveCSS("width", "184px");
    await expect(collapsedBrandMark).toHaveCSS("height", "50px");
    await expect(collapsedBrandMark).toHaveCSS("padding", "0px");
    expect(await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>("#main-navigation")!.getBoundingClientRect();
      const lockup = document.querySelector<HTMLElement>("#main-navigation .logo-crop.wordmark")!.getBoundingClientRect();
      return lockup.left - sidebar.left;
    })).toBeCloseTo(24, 0);
  };
  const expectCollapsedBrandMark = async () => {
    await expect(collapsedBrandMark.locator("img")).toHaveAttribute("src", "/logos/brand-mark.svg");
    await expect(collapsedBrandMark).toHaveCSS("width", "40px");
    await expect(collapsedBrandMark).toHaveCSS("height", "40px");
    await expect(collapsedBrandMark).toHaveCSS("padding", "0px");
    expect(await page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>("#main-navigation")!.getBoundingClientRect();
      const mark = document.querySelector<HTMLElement>("#main-navigation .logo-crop.wordmark")!.getBoundingClientRect();
      return Math.abs((mark.left + mark.width / 2) - (rail.left + rail.width / 2));
    })).toBeLessThanOrEqual(1);
  };

  await expectExpandedBrandLockup();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expectCollapsedBrandMark();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expectExpandedBrandLockup();

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const expandedWorkspace = await page.locator(".workspace").boundingBox();
  expect(await sidebar.evaluate(element => getComputedStyle(element).transitionDuration)).toContain("0.18s");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveCSS("width", "76px");
  await expect(sidebar).not.toHaveAttribute("aria-hidden", "true");
  await expect(sidebar).not.toHaveAttribute("inert", "");
  await expect(sidebar.getByRole("link", { name: "Overview", exact: true })).toBeVisible();
  await expectCollapsedBrandMark();
  await expect(page.locator(".topbar-brand-mark img")).toHaveAttribute("src", "/logos/medtech-lockup.svg?v=4");

  const collapsedGeometry = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>(".workspace")!.getBoundingClientRect();
    const content = document.querySelector<HTMLElement>(".content")!.getBoundingClientRect();
    const header = document.querySelector<HTMLElement>(".topbar-inner")!.getBoundingClientRect();
    const logo = document.querySelector<HTMLElement>(".topbar-brand-mark")!.getBoundingClientRect();
    const dashboard = document.querySelector<HTMLElement>(".dashboard-layout")!.getBoundingClientRect();
    return {
      workspaceLeft: workspace.left,
      workspaceWidth: workspace.width,
      contentWidth: content.width,
      contentOffset: Math.abs((content.left + content.width / 2) - (workspace.left + workspace.width / 2)),
      headerWidth: header.width,
      headerLeft: header.left,
      logoLeft: logo.left,
      dashboardWidth: dashboard.width,
    };
  });
  expect(collapsedGeometry.workspaceLeft).toBeCloseTo(76, 0);
  expect(collapsedGeometry.workspaceWidth).toBeGreaterThan(expandedWorkspace!.width + 190);
  expect(collapsedGeometry.workspaceWidth).toBeLessThan(expandedWorkspace!.width + 210);
  expect(collapsedGeometry.contentWidth).toBeCloseTo(1460, 0);
  expect(collapsedGeometry.contentOffset).toBeLessThanOrEqual(1);
  expect(collapsedGeometry.headerWidth).toBeCloseTo(collapsedGeometry.workspaceWidth - 96, 0);
  expect(collapsedGeometry.headerLeft - collapsedGeometry.workspaceLeft).toBeCloseTo(48, 0);
  expect(collapsedGeometry.logoLeft).toBeCloseTo(collapsedGeometry.headerLeft, 0);
  expect(collapsedGeometry.dashboardWidth).toBeLessThanOrEqual(collapsedGeometry.contentWidth);

  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(sidebar).not.toHaveAttribute("aria-hidden", "true");
  await expect(sidebar).not.toHaveAttribute("inert", "");
  await expect(sidebar).toBeVisible();
  await expectExpandedBrandLockup();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".topbar-brand-mark")).toBeHidden();
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(sidebar.locator(".logo-crop.wordmark img")).toHaveAttribute("src", "/logos/medtech-lockup.svg?v=4");
  expect(await sidebar.locator(".logo-crop.wordmark").boundingBox()).toMatchObject({ width: 165, height: 50 });
});

test("compact header controls keep their geometry through dark-mode changes", async ({ page }) => {
  await installUiApi(page, [], ["notification.self.read", "notification.self.manage"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const controls = [
    ["sidebar", page.locator(".desktop-sidebar-toggle")],
    ["notifications", page.locator(".notification-trigger")],
    ["theme", page.locator(".topbar-actions > .icon-button")],
  ] as const;
  const headerMetrics = async () => Object.fromEntries(await Promise.all(controls.map(async ([name, control]) => [name, await control.evaluate(button => {
    const icon = button.querySelector<SVGElement>("svg");
    const buttonBox = button.getBoundingClientRect();
    const iconBox = icon?.getBoundingClientRect();
    return {
      button: [buttonBox.width, buttonBox.height],
      icon: iconBox ? [iconBox.width, iconBox.height] : null,
      padding: getComputedStyle(button).padding,
    };
  })])));

  const expected = {
    sidebar: { button: [44, 44], icon: [18, 18], padding: "0px" },
    notifications: { button: [44, 44], icon: [18, 18], padding: "0px" },
    theme: { button: [44, 44], icon: [18, 18], padding: "0px" },
  };
  expect(await headerMetrics()).toEqual(expected);

  await page.locator(".topbar-actions > .icon-button").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await headerMetrics()).toEqual(expected);
  await page.waitForTimeout(250);
  expect(await headerMetrics()).toEqual(expected);

  await expect(page.locator(".logo-crop.wordmark")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator(".sidebar")).toHaveCSS("background-color", "rgb(11, 24, 43)");
  await expect(page.locator(".dashboard-layout")).toBeVisible();
  await page.locator(".desktop-sidebar-toggle").click();
  await expect(page.locator(".topbar-brand-mark")).toBeVisible();
  await expect(page.locator(".topbar-brand-mark")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect(await page.locator(".topbar-brand-mark").boundingBox()).toMatchObject({ width: 168, height: 46 });
  await expect(page.locator(".topbar-brand-mark img")).toHaveAttribute("src", "/logos/medtech-lockup.svg?v=4");

  await page.setViewportSize({ width: 1024, height: 720 });
  await page.reload();
  await page.locator(".topbar-actions > .icon-button").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".mobile-menu")).toBeHidden();
  await expect(page.locator(".desktop-sidebar-toggle")).toBeVisible();

  await page.setViewportSize({ width: 1023, height: 720 });
  await page.reload();
  await page.locator(".topbar-actions > .icon-button").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const menu = page.locator(".mobile-menu");
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(button => {
    const buttonBox = button.getBoundingClientRect();
    const iconBox = button.querySelector("svg")!.getBoundingClientRect();
    return { button: [buttonBox.width, buttonBox.height], icon: [iconBox.width, iconBox.height], padding: getComputedStyle(button).padding };
  })).toEqual({ button: [44, 44], icon: [20, 20], padding: "0px" });
  await expect(page.locator(".topbar-brand-mark")).toBeHidden();

  await menu.click();
  const close = page.locator(".sidebar-close");
  await expect(close).toBeVisible();
  expect(await close.evaluate(button => {
    const buttonBox = button.getBoundingClientRect();
    const iconBox = button.querySelector("svg")!.getBoundingClientRect();
    return { button: [buttonBox.width, buttonBox.height], icon: [iconBox.width, iconBox.height], padding: getComputedStyle(button).padding };
  })).toEqual({ button: [44, 44], icon: [18, 18], padding: "0px" });
});

test("dark mode keeps the light-mode shell geometry and elevation", async ({ page }) => {
  await installUiApi(page, [{
    id: "employee-1", employeeCode: "MTC001", firstName: "UI", lastName: "Admin", email: "ui.admin@example.invalid", hireDate: "2020-01-01", employmentStatus: "ACTIVE"
  }]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("search")).toBeVisible();

  const shell = async () => page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return [rect.x, rect.y, rect.width, rect.height];
    };
    const shadow = (selector: string) => getComputedStyle(document.querySelector<HTMLElement>(selector)!).boxShadow.replace(/rgba?\([^)]*\)/g, "color");
    const command = document.querySelector<HTMLElement>(".page-search-command")!;
    return {
      search: box('[role="search"]'),
      pageSearchCommand: { box: box(".page-search-command"), borderWidth: getComputedStyle(command).borderWidth, borderRadius: getComputedStyle(command).borderRadius, padding: getComputedStyle(command).padding },
      wordmarkRadius: getComputedStyle(document.querySelector<HTMLElement>(".logo-crop.wordmark")!).borderRadius,
      navShadow: shadow(".nav-list a.active")
    };
  });

  const light = await shell();
  await page.locator(".topbar-actions > .icon-button").click();
  const dark = await shell();
  expect(dark).toEqual(light);

  await page.goto("/employees");
  await expect(page.locator(".employee-card").first()).toBeVisible();
  const cardShadow = async () => page.locator(".employee-card").first().evaluate(element => getComputedStyle(element).boxShadow.replace(/rgba?\([^)]*\)/g, "color"));
  const darkCardShadow = await cardShadow();
  await page.locator(".topbar-actions > .icon-button").click();
  expect(await cardShadow()).toBe(darkCardShadow);
});

test("dark mobile account avatar keeps the light-mode circular frame", async ({ page }) => {
  await installUiApi(page, []);
  await page.setViewportSize({ width: 1023, height: 720 });
  await page.goto("/");

  const accountFrame = () => page.locator(".account-menu--topbar .account-trigger").evaluate(element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return { box: [rect.width, rect.height], borderRadius: style.borderRadius, borderWidth: style.borderWidth, padding: style.padding };
  });

  const light = await accountFrame();
  await page.locator(".topbar-actions > .icon-button").click();
  expect(await accountFrame()).toEqual(light);
});

test("phone create menu and account photo controls stay aligned", async ({ page }) => {
  await installUiApi(page, [{
    id: "employee-1", employeeCode: "MTC001", firstName: "UI", lastName: "Admin", email: "ui.admin@example.invalid", hireDate: "2020-01-01", employmentStatus: "ACTIVE",
    profilePhoto: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
  }], ["employee.self.update_basic"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.locator(".topbar .quick-create__trigger").click();
  const [header, createMenu] = await Promise.all([page.locator(".topbar").boundingBox(), page.locator(".topbar .quick-create__menu").boundingBox()]);
  expect(header).not.toBeNull();
  expect(createMenu).not.toBeNull();
  expect(createMenu!.x).toBeGreaterThanOrEqual(12);
  expect(createMenu!.x + createMenu!.width).toBeLessThanOrEqual(378);
  expect(createMenu!.y).toBeGreaterThan(header!.y + header!.height);
  await expect(page.locator(".page-search-command")).toBeHidden();
  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "Search modules and actions" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto(navPaths["My HR"]);
  const [photo, replace, remove] = await Promise.all([
    page.locator(".account-photo-preview").boundingBox(),
    page.locator(".account-photo-actions .button-like").boundingBox(),
    page.locator(".account-photo-actions button").boundingBox(),
  ]);
  expect(photo).not.toBeNull();
  expect(replace).not.toBeNull();
  expect(remove).not.toBeNull();
  expect(Math.abs(replace!.y - photo!.y)).toBeLessThanOrEqual(1);
  expect(replace!.x).toBeCloseTo(remove!.x, 1);
  expect(replace!.width).toBeCloseTo(remove!.width, 1);

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await expect(page.locator(".mobile-menu")).toBeHidden();
  await expect(page.locator(".desktop-sidebar-toggle")).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator(".account-menu--sidebar .account-avatar")).toHaveCSS("border-radius", "999px");
  await expect(page.locator(".account-menu--sidebar .account-avatar img")).toHaveCSS("border-radius", "999px");
});

test("login is dark-only, keeps the centered premium composition and stays responsive", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.clear();
    localStorage.removeItem("medtech-hr-theme");
  });
  await page.route("**/api/v1/auth/me", route => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: { code: "UNAUTHENTICATED", message: "Sign in required" } })
  }));

  for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await test.step(`${viewport.width}x${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await page.goto("/", { waitUntil: "networkidle" });

      const stage = page.locator(".login-stage");
      const card = page.locator(".login-card");
      await expect(page.locator(".login-brand img")).toHaveAttribute("src", "/logos/medtech-lockup.svg?v=4");
      await expect(page.getByRole("button", { name: /Switch to (light|dark) mode/ })).toHaveCount(0);
      await expect(page.getByText("Role-based access. Protected activity is audited.", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Access is limited to the work assigned to you.", { exact: true })).toHaveCount(0);

      const cardBox = (await card.boundingBox())!;
      expect(cardBox.x).toBeGreaterThanOrEqual(0);
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(viewport.width);
      expect(cardBox.y).toBeGreaterThanOrEqual(0);
      expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(viewport.height + 1);
      await expect(stage).toBeVisible();
      if (viewport.width > 720) expect(Math.abs(cardBox.x + cardBox.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
      await expect(page.locator(".login-stage-art")).toHaveCSS("background-image", /login-medtech-hero\.webp/);
      await expect(page.locator(".login-stage-art")).toHaveCSS("mask-image", /radial-gradient/);
      await expect(page.getByRole("button", { name: "Sign in with Microsoft" })).toBeVisible();
      const microsoftSignIn = page.getByRole("button", { name: "Sign in with Microsoft" });
      await expect(microsoftSignIn).toHaveCSS("background-color", "rgb(20, 37, 65)");
      await microsoftSignIn.hover();
      await expect(microsoftSignIn).toHaveCSS("background-color", "rgb(26, 45, 75)");
      await expect(microsoftSignIn).toHaveCSS("color", "rgb(242, 246, 253)");
      await microsoftSignIn.focus();
      await expect(microsoftSignIn).toHaveCSS("outline-style", "solid");
      await expect(page.getByLabel("Email").locator("xpath=..")).toHaveCSS("height", "52px");
      await expect(page.getByLabel("Password").locator("xpath=..")).toHaveCSS("height", "52px");
      await page.getByLabel("Email").focus();
      expect(await page.locator(".login-input").first().evaluate(element => getComputedStyle(element).boxShadow)).not.toBe("none");
      const signIn = page.getByRole("button", { name: "Sign in", exact: true });
      await signIn.hover();
      expect(await signIn.evaluate(element => getComputedStyle(element).transform)).toBe("none");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }

  const logoAsset = await page.evaluate(async () => (await fetch("/logos/medtech-lockup.svg?v=4")).text());
  expect((logoAsset.match(/rgb\(13\.725281%, 19\.607544%, 41\.567993%\)/g) ?? []).length).toBe(16);
  expect(logoAsset).not.toMatch(/<rect\b|<image\b|#D7A7BE/);

  const contrast = await page.evaluate(() => {
    const luminance = (color: string) => {
      const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => value / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
    };
    const ratio = (foreground: Element, background: Element) => {
      const lighter = Math.max(luminance(getComputedStyle(foreground).color), luminance(getComputedStyle(background).backgroundColor));
      const darker = Math.min(luminance(getComputedStyle(foreground).color), luminance(getComputedStyle(background).backgroundColor));
      return (lighter + 0.05) / (darker + 0.05);
    };
    return {
      heading: ratio(document.querySelector(".login-intro h1")!, document.querySelector(".login-card")!)
    };
  });
  expect(contrast.heading).toBeGreaterThanOrEqual(4.5);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".login-card")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".login-stage-art")).toHaveCSS("animation-name", "none");
});

test("local login preserves validation, busy state and backend session flow", async ({ page }) => {
  let loginBody: unknown;
  let attempts = 0;
  await page.addInitScript(() => sessionStorage.clear());
  await page.route("**/api/v1/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/auth/me") {
      return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false }) });
    }
    if (pathname === "/api/v1/auth/login") {
      loginBody = route.request().postDataJSON();
      attempts += 1;
      await new Promise(resolve => setTimeout(resolve, 150));
      if (attempts === 1) return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: { code: "INVALID_CREDENTIALS", message: "Incorrect email or password." } })
      });
      const { csrfToken, ...user } = session;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { csrfToken, user } })
      });
    }
    if (pathname === "/api/v1/attendance/reports/summary") return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { summary: { totalRecords: 0, byStatus: {} } } })
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [], meta: { total: 0, page: 1, limit: 100, totalPages: 1 } })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Email")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Email")).toBeFocused();

  await page.getByLabel("Email").fill("ui.admin@example.invalid");
  await page.getByLabel("Password").fill("valid-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("API request failed (401)");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Signing in..." })).toBeDisabled();
  await expect(page.locator(".app")).toBeVisible();
  expect(loginBody).toEqual({ email: "ui.admin@example.invalid", password: "valid-password" });
});

test("Microsoft login keeps the existing start route", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.clear());
  await page.route("**/api/v1/auth/me", route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false }) }));
  await page.route("**/api/v1/auth/microsoft/start", route => route.fulfill({ status: 204 }));
  await page.goto("/");

  const start = page.waitForRequest(request => new URL(request.url()).pathname === "/api/v1/auth/microsoft/start");
  await page.getByRole("button", { name: "Sign in with Microsoft" }).click();
  await start;
});

test("unknown URLs show an explicit not-found page", async ({ page }) => {
  await page.goto("/not-a-module");
  await expect(page).toHaveTitle("Page not found | MedTech HR ERP");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("notification actions stay right-aligned and the popover remains visible beside responsive search", async ({ page }) => {
  await installUiApi(page, [], ["notification.self.read", "notification.self.manage"]);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1152, height: 768 }, { width: 1024, height: 768 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
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
      if (viewport.width <= 1023) expect(actions!.y + actions!.height).toBeLessThanOrEqual(search!.y);
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
      await expect(popover).toHaveClass(/is-closing/);
      await expect(popover).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
});

test("employee add, edit, and profile dialogs use the wide layout without leaving the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installUiApi(page, [{
    id: "employee-1", employeeCode: "MTC005", firstName: "Dima Osama Ahmad", lastName: "Alhawi Hassan Al Hajri",
    email: "mtc005.application.manager.long.address@example.invalid", phone: "+974 5000 1234", hireDate: "2017-04-05", employmentStatus: "ACTIVE",
    department: { id: "department-1", name: "Diagnostics & POCT", code: "DPOCT" },
    position: { title: "Application Manager for Diagnostics and Point of Care Technologies", code: "APP-MGR" }
  }], ["employee.hr.update", "payroll.read_compensation", "report.export"]);
  await page.goto("/employees");
  const employeeCard = page.locator("article").filter({ hasText: "Dima Osama Ahmad Alhawi Hassan Al Hajri" });
  await expect(employeeCard).toContainText("+974 5000 1234");
  expect(await employeeCard.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(employeeCard.getByRole("button", { name: "Open profile" })).toBeVisible();
  await employeeCard.locator("summary").click();
  await expect(employeeCard.getByRole("button", { name: "Edit employee" })).toBeVisible();
  await expect(employeeCard.getByRole("button", { name: "Download PDF" })).toBeVisible();
  await employeeCard.locator("summary").click();

  await page.getByRole("button", { name: "Add employee" }).click();
  const addPanel = page.locator(".modal:has(> .employee-editor)");
  const addDesktop = await addPanel.boundingBox();
  expect(addDesktop).not.toBeNull();
  expect(addDesktop!.width).toBeGreaterThanOrEqual(900);
  expect(addDesktop!.width).toBeLessThanOrEqual(920);
  await expect(addPanel.getByLabel("Employee Code", { exact: true })).toHaveValue("MTC006");
  await expect(addPanel.getByLabel("Access role", { exact: true })).toBeVisible();
  await addPanel.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: /Dima Osama Ahmad Alhawi Hassan Al Hajri/ }).click();

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

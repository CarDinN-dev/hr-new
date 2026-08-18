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

async function installUiApi(page: Page, employees: unknown[] = [], extraPermissions: string[] = [], initialTheme: "light" | "dark" = "light") {
  await page.addInitScript(({ value, permissions, theme }) => {
    sessionStorage.setItem("medtech-hr-erp-backend-session-v2", JSON.stringify({ ...value, permissions: [...value.permissions, ...permissions] }));
    localStorage.setItem("medtech-hr-theme", theme);
  }, { value: session, permissions: extraPermissions, theme: initialTheme });
  await page.route("**/api/v1/**", route => {
    const pathname = new URL(route.request().url()).pathname;
    const data = pathname === "/api/v1/employees" ? employees
      : pathname === "/api/v1/notifications" ? [{ id: "notification-1", type: "TEST", title: "Test notification", message: "Visible notification content", createdAt: "2026-08-11T08:00:00.000Z", readAt: null }]
      : pathname === "/api/v1/approvals/inbox" ? { leave: [], certificates: [], payroll: [] }
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
  await expect(page.getByRole("link", { name: "Business Trips" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Expenses" })).toHaveCount(0);
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
        const colors = await page.evaluate(() => {
          const root = getComputedStyle(document.documentElement);
          const firstSurface = document.querySelector<HTMLElement>(".content :is(.panel, .metric, .report-card, .employee-card, .payroll-tile):not(.hero-panel)");
          return {
            canvas: root.getPropertyValue("--canvas").trim().toLowerCase(),
            body: getComputedStyle(document.body).backgroundColor,
            search: getComputedStyle(document.querySelector<HTMLElement>('[role="search"]')!).backgroundColor,
            surface: firstSurface ? getComputedStyle(firstSurface).backgroundColor : null,
          };
        });
        expect(colors.canvas).toBe(expected.canvas);
        expect(colors.body).toBe(expected.body);
        expect(colors.search).toBe(expected.surface);
        if (colors.surface) expect(colors.surface).toBe(expected.surface);
        await expect(page.locator(".mobile-menu")).toBeHidden();
        await expect(page.locator(".sidebar-close")).toBeHidden();
      });
    }
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1200, height: 900 },
  { width: 1081, height: 900 },
  { width: 1080, height: 900 },
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
          if (viewport.width <= 1080) expect(actions!.y + actions!.height).toBeLessThanOrEqual(searchBox!.y);
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
          expect(surface!.borderRadius).toBe("12px");
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
  expect(await logo.evaluate(image => ({ source: (image as HTMLImageElement).getAttribute("src"), width: (image as HTMLImageElement).naturalWidth, transform: getComputedStyle(image).transform }))).toEqual({ source: "/logos/medtech-lockup.svg?v=4", width: 840, transform: "none" });
  const [sidebarLogo, heroLogo] = await Promise.all([
    page.locator(".logo-crop.wordmark").boundingBox(),
    page.locator(".hero-logo-crop").boundingBox(),
  ]);
  expect(sidebarLogo).toMatchObject({ width: 229, height: 72 });
  expect(heroLogo).toMatchObject({ width: 360, height: 99 });
  await expect(page.locator(".hero-logo-crop img")).toHaveAttribute("src", "/logos/medtech-lockup.svg?v=4");
  await expect(page.locator(".logo-crop.wordmark")).toHaveCSS("background-color", "rgb(245, 245, 247)");
  await expect(page.locator(".hero-logo-crop")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(logo).toHaveAttribute("alt", "MedTech Corporation Trading W.L.L.");
  await expect(page.locator(".mobile-menu")).toBeHidden();
  await expect(page.locator(".sidebar-close")).toBeHidden();

  const primaryColors = await page.getByRole("button", { name: "Add employee" }).evaluate(element => ({
    background: getComputedStyle(element).backgroundColor,
    color: getComputedStyle(element).color,
    height: element.getBoundingClientRect().height,
  }));
  expect(primaryColors).toEqual({ background: "rgb(198, 22, 46)", color: "rgb(255, 255, 255)", height: 42 });
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
  const [mobileHeroLogo, mobileHeaderLogo] = await Promise.all([
    page.locator(".hero-logo-crop").boundingBox(),
    page.locator(".topbar-brand-mark").boundingBox(),
  ]);
  expect(mobileHeroLogo).toMatchObject({ width: 320, height: 88 });
  expect(mobileHeaderLogo).toMatchObject({ width: 60, height: 48 });
  await expect(page.locator(".topbar-brand-mark img")).toHaveCSS("content", /brand-mark\.svg\?v=4/);
  await expect(page.locator(".topbar-brand-mark")).toHaveCSS("background-color", "rgb(245, 245, 247)");
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
  expect(Math.abs(balance!.height - request!.height)).toBeLessThanOrEqual(1);
});

test("navigation drawer cannot block header controls across the 1080px breakpoint", async ({ page }) => {
  await installUiApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const sidebar = page.locator("#main-navigation");
  const desktopToggle = page.getByRole("button", { name: "Collapse sidebar" });
  await expect(sidebar).toBeVisible();
  await expect(desktopToggle).toHaveCSS("width", "44px");
  await desktopToggle.click();
  await expect(sidebar).toBeHidden();
  expect(await page.locator(".topbar-brand-mark").boundingBox()).toMatchObject({ width: 184, height: 50 });
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(sidebar).toBeVisible();

  await page.setViewportSize({ width: 1080, height: 900 });
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
  await page.setViewportSize({ width: 1081, height: 900 });
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

test("compact header controls keep their geometry through dark-mode changes", async ({ page }) => {
  await installUiApi(page, [], ["notification.self.read", "notification.self.manage"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const controls = [
    ["sidebar", page.locator(".desktop-sidebar-toggle")],
    ["notifications", page.locator(".notification-trigger")],
    ["theme", page.locator(".topbar-actions > .icon-button")],
    ["account", page.locator(".account-menu--topbar > .account-trigger")],
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
    account: { button: [44, 44], icon: null, padding: "0px" },
  };
  expect(await headerMetrics()).toEqual(expected);

  await page.locator(".topbar-actions > .icon-button").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await headerMetrics()).toEqual(expected);
  await page.waitForTimeout(250);
  expect(await headerMetrics()).toEqual(expected);

  await expect(page.locator(".logo-crop.wordmark")).toHaveCSS("background-color", "rgb(245, 245, 247)");
  await expect(page.locator(".hero-logo-crop")).toHaveCSS("background-color", "rgb(245, 245, 247)");
  await page.locator(".desktop-sidebar-toggle").click();
  await expect(page.locator(".topbar-brand-mark")).toBeVisible();
  await expect(page.locator(".topbar-brand-mark")).toHaveCSS("background-color", "rgb(245, 245, 247)");
  await expect(page.locator(".topbar-brand-mark img")).toHaveAttribute("src", "/logos/medtech-lockup.svg?v=4");

  await page.setViewportSize({ width: 1024, height: 768 });
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
  await expect(page.locator(".topbar-brand-mark")).toHaveCSS("background-color", "rgb(245, 245, 247)");
  await expect(page.locator(".topbar-brand-mark img")).toHaveCSS("content", /brand-mark\.svg\?v=4/);

  await menu.click();
  const close = page.locator(".sidebar-close");
  await expect(close).toBeVisible();
  expect(await close.evaluate(button => {
    const buttonBox = button.getBoundingClientRect();
    const iconBox = button.querySelector("svg")!.getBoundingClientRect();
    return { button: [buttonBox.width, buttonBox.height], icon: [iconBox.width, iconBox.height], padding: getComputedStyle(button).padding };
  })).toEqual({ button: [44, 44], icon: [18, 18], padding: "0px" });
});

test("login keeps the exact brand assets, hero and controls responsive", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.clear();
    localStorage.removeItem("medtech-hr-theme");
  });
  await page.route("**/api/v1/auth/me", route => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: { code: "UNAUTHENTICATED", message: "Sign in required" } })
  }));

  for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await test.step(`${viewport.width}x${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await page.goto("/", { waitUntil: "networkidle" });

      const mobile = viewport.width < 720;
      const stage = page.locator(".login-stage");
      const mobileLogo = page.locator(".login-mobile-logo");
      const themeButton = page.getByRole("button", { name: "Switch to dark mode" });
      await expect(stage)[mobile ? "toBeHidden" : "toBeVisible"]();
      await expect(mobileLogo)[mobile ? "toBeVisible" : "toBeHidden"]();
      await expect(themeButton).toHaveCSS("height", "44px");
      await expect(page.getByText("Role-based access. Protected activity is audited.", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Access is limited to the work assigned to you.", { exact: true })).toHaveCount(0);

      if (mobile) {
        await expect(mobileLogo.locator("img")).toHaveAttribute("src", "/logos/medtech-lockup.svg?v=4");
        expect(await mobileLogo.boundingBox()).toMatchObject({ width: 210, height: 58 });
        await expect(mobileLogo).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        expect(await page.evaluate(() => performance.getEntriesByType("resource").some(entry => entry.name.includes("login-medtech-hero.webp")))).toBe(false);
        await themeButton.click();
        expect(await mobileLogo.boundingBox()).toMatchObject({ width: 226, height: 70 });
        await expect(mobileLogo).toHaveCSS("background-color", "rgb(245, 245, 247)");
      } else {
        const headerMark = page.locator(".login-product img");
        const stageLogo = page.locator(".login-stage-logo");
        const stageCopy = page.locator(".login-stage-copy");
        expect(await headerMark.boundingBox()).toMatchObject({ width: 72, height: 58 });
        await expect(stageLogo.locator("img")).toHaveAttribute("src", "/logos/medtech-lockup.svg?v=4");
        expect((await stageLogo.boundingBox())!.width).toBe(viewport.width === 1440 ? 448 : 348);
        await expect(stageLogo).toHaveCSS("background-color", "rgb(245, 245, 247)");
        await expect(stageLogo).toHaveCSS("opacity", "1");
        await expect(stageCopy).toHaveCSS("opacity", "1");
        const logoBox = (await stageLogo.boundingBox())!;
        const copyBox = (await stageCopy.boundingBox())!;
        expect(copyBox.y - (logoBox.y + logoBox.height)).toBeGreaterThanOrEqual(27);
        await expect(page.locator(".login-stage-art")).toHaveCSS("background-image", /login-medtech-hero\.webp/);
        expect(await page.evaluate(() => performance.getEntriesByType("resource").some(entry => entry.name.includes("login-medtech-hero.webp")))).toBe(true);
      }

      await expect(page.getByRole("button", { name: "Sign in with Microsoft" })).toBeVisible();
      await expect(page.getByLabel("Email")).toHaveCSS("height", "52px");
      await expect(page.getByLabel("Password")).toHaveCSS("height", "52px");
      await page.getByLabel("Email").focus();
      expect(await page.getByLabel("Email").evaluate(element => getComputedStyle(element).boxShadow)).not.toBe("none");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }

  const stageLogoAsset = await page.evaluate(async () => (await fetch("/logos/medtech-lockup.svg?v=4")).text());
  expect((stageLogoAsset.match(/rgb\(13\.725281%, 19\.607544%, 41\.567993%\)/g) ?? []).length).toBe(16);
  expect(stageLogoAsset).not.toMatch(/<rect\b|<image\b|#D7A7BE/);

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".login-stage")).toBeVisible();
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
      heading: ratio(document.querySelector(".login-intro h1")!, document.querySelector(".login-card")!),
      action: ratio(document.querySelector(".login-card .primary")!, document.querySelector(".login-card .primary")!)
    };
  });
  expect(contrast.heading).toBeGreaterThanOrEqual(4.5);
  expect(contrast.action).toBeGreaterThanOrEqual(4.5);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".login-card")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".login-stage-art")).toHaveCSS("animation-name", "none");
});

test("local login preserves validation, busy state and backend session flow", async ({ page }) => {
  let loginBody: unknown;
  await page.addInitScript(() => sessionStorage.clear());
  await page.route("**/api/v1/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/auth/me") {
      return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false }) });
    }
    if (pathname === "/api/v1/auth/login") {
      loginBody = route.request().postDataJSON();
      await new Promise(resolve => setTimeout(resolve, 150));
      const { csrfToken, ...user } = session;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { csrfToken, user } })
      });
    }
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
  await expect(page.getByRole("button", { name: "Signing in..." })).toBeDisabled();
  await expect(page.locator(".app")).toBeVisible();
  expect(loginBody).toEqual({ email: "ui.admin@example.invalid", password: "valid-password" });
});

test("unknown URLs show an explicit not-found page", async ({ page }) => {
  await page.goto("/not-a-module");
  await expect(page).toHaveTitle("Page not found | MedTech HR ERP");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("notification actions stay right-aligned and the popover remains visible beside responsive search", async ({ page }) => {
  await installUiApi(page, [], ["notification.self.read", "notification.self.manage"]);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1081, height: 900 }, { width: 1080, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
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
      if (viewport.width <= 1080) expect(actions!.y + actions!.height).toBeLessThanOrEqual(search!.y);
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

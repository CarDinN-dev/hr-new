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
  expect(await logo.evaluate(image => ({ width: (image as HTMLImageElement).naturalWidth, transform: getComputedStyle(image).transform }))).toEqual({ width: 300, transform: "none" });
  const [sidebarLogo, heroLogo] = await Promise.all([
    page.locator(".logo-crop.wordmark").boundingBox(),
    page.locator(".hero-logo-crop").boundingBox(),
  ]);
  expect(sidebarLogo).toMatchObject({ width: 88, height: 70 });
  expect(heroLogo).toMatchObject({ width: 144, height: 115 });
  await expect(page.locator(".logo-crop.wordmark")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator(".hero-logo-crop")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.getByText("MedTech HR ERP", { exact: true })).toBeVisible();
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
  expect(mobileHeroLogo).toMatchObject({ width: 144, height: 115 });
  expect(mobileHeaderLogo).toMatchObject({ width: 52, height: 42 });
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
  expect(Math.abs(balance!.height - request!.height)).toBeLessThanOrEqual(1);
});

test("navigation drawer cannot block header controls across the 1080px breakpoint", async ({ page }) => {
  await installUiApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const sidebar = page.locator("#main-navigation");
  const desktopToggle = page.getByRole("button", { name: "Collapse sidebar" });
  await expect(sidebar).toBeVisible();
  await expect(desktopToggle).toHaveCSS("width", "40px");
  await desktopToggle.click();
  await expect(sidebar).toBeHidden();
  expect(await page.locator(".topbar-brand-mark").boundingBox()).toMatchObject({ width: 52, height: 42 });
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
  await expect(themeButton).toHaveCSS("width", "40px");
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

test("login uses the full uncropped brand mark", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const logo = page.locator(".login-logo");
  await expect(logo).toBeVisible();
  expect(await logo.boundingBox()).toMatchObject({ width: 160, height: 128 });
  await expect(logo).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(logo.locator("img")).toHaveCSS("transform", "none");
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

from __future__ import annotations

from pathlib import Path
from textwrap import dedent
import json

ROOT = Path(__file__).resolve().parents[1]


def replace_once(relative_path: str, old: str, new: str) -> None:
    path = ROOT / relative_path
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected source block not found in {relative_path}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


# Canonical RBAC matrix: attendance is HR/executive-only; employees retain
# self-service access to published payslips.
catalog_path = ROOT / "backend/prisma/rbac-catalog.json"
catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
roles = {role["code"]: role for role in catalog["roles"]}


def remove_permissions(role_code: str, permissions: set[str]) -> None:
    role = roles[role_code]
    role["permissions"] = [permission for permission in role["permissions"] if permission not in permissions]


remove_permissions(
    "EMPLOYEE",
    {"attendance.self.read", "attendance.self.create", "attendance.self.correct_request"},
)
remove_permissions("LINE_MANAGER", {"attendance.team.read", "attendance.team.review"})
remove_permissions("MANAGER", {"attendance.management.read", "attendance.management.review"})
employee_permissions = roles["EMPLOYEE"]["permissions"]
if "payroll.self.read_payslip" not in employee_permissions:
    insert_after = employee_permissions.index("service_request.self.download") + 1
    employee_permissions.insert(insert_after, "payroll.self.read_payslip")
catalog_path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

# Payroll role decorators must honour the exact declared role list.
replace_once(
    "backend/src/modules/authorization/permissions.guard.ts",
    "import { hasActiveSuperAdminRole, hasActiveSystemAdministratorRole, hasPayrollRole } from '../../common/authorization';",
    "import { hasActiveSuperAdminRole, hasActiveSystemAdministratorRole } from '../../common/authorization';",
)
replace_once(
    "backend/src/modules/authorization/permissions.guard.ts",
    """    const payrollRoles = this.reflector.getAllAndOverride<string[]>(PAYROLL_ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (payrollRoles?.length && (!request.user || !hasPayrollRole(request.user))) {
      await this.recordDenial(context, 'Payroll role required');
      throw new ForbiddenException('Payroll access is limited to HR, CPO, and COO roles');
    }
""",
    """    const payrollRoles = this.reflector.getAllAndOverride<string[]>(PAYROLL_ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (payrollRoles?.length) {
      const user = request.user;
      const hasDeclaredRole = !!user && (
        hasActiveSuperAdminRole(user)
        || payrollRoles.some((role) => user.roles.includes(role))
      );
      if (!hasDeclaredRole) {
        await this.recordDenial(context, 'Payroll role required');
        throw new ForbiddenException(`Payroll access requires one of: ${payrollRoles.join(', ')}`);
      }
    }
""",
)

# Keep employee-owned, published payslip routes permission-only. Apply payroll
# role gates to organization-wide views and exports route-by-route.
replace_once(
    "backend/src/modules/payroll/payroll.controller.ts",
    "@PayrollRoles('HR', 'CPO', 'COO')\n@Controller('payroll')",
    "@Controller('payroll')",
)
payroll_route_replacements = {
    "  @Permissions('payroll.read') @Get('adjustments')": "  @PayrollRoles('HR', 'CPO', 'COO') @Permissions('payroll.read') @Get('adjustments')",
    "  @AnyPermission('payroll.read', 'payroll.audit.read') @Get('runs')": "  @PayrollRoles('HR', 'CPO', 'COO') @AnyPermission('payroll.read', 'payroll.audit.read') @Get('runs')",
    "  @AnyPermission('payroll.read', 'payroll.audit.read') @Get('runs/:id')": "  @PayrollRoles('HR', 'CPO', 'COO') @AnyPermission('payroll.read', 'payroll.audit.read') @Get('runs/:id')",
    "  @Permissions('payroll.export') @Get('departments')": "  @PayrollRoles('HR', 'CPO', 'COO') @Permissions('payroll.export') @Get('departments')",
    "  @Permissions('payroll.payslip.read_all') @Get('payslips')": "  @PayrollRoles('HR', 'CPO', 'COO') @Permissions('payroll.payslip.read_all') @Get('payslips')",
    "  @Permissions('payroll.export') @Get('runs/:id/export')": "  @PayrollRoles('HR', 'CPO', 'COO') @Permissions('payroll.export') @Get('runs/:id/export')",
}
for old, new in payroll_route_replacements.items():
    replace_once("backend/src/modules/payroll/payroll.controller.ts", old, new)

# Frontend navigation mirrors the server matrix.
replace_once(
    "src/authorization.tsx",
    '  Attendance: ["attendance.self.read", "attendance.team.read", "attendance.management.read", "attendance.hr.read", "attendance.read_all"],',
    '  Attendance: ["attendance.hr.read", "attendance.hr.manage", "attendance.audit.read", "attendance.read_all"],',
)
replace_once(
    "src/authorization.tsx",
    '  if (route === "Payroll") return hasActiveSuperAdminRole(session) || ["HR", "CPO", "COO"].some(role => session.roles.includes(role));',
    '  if (route === "Payroll") return hasActiveSuperAdminRole(session) || ["HR", "CPO", "COO"].some(role => session.roles.includes(role)) || hasPermission(session, "payroll.self.read_payslip");',
)

# Frontend route regression coverage.
authorization_test = ROOT / "src/authorization.test.ts"
authorization_source = authorization_test.read_text(encoding="utf-8")
marker = "\n});\n"
if not authorization_source.endswith(marker):
    raise SystemExit("Unexpected authorization.test.ts ending")
new_frontend_test = r'''

  it("keeps attendance private below HR and exposes only employee-owned payslips", () => {
    const lowerRoles: Array<[string, string]> = [
      ["EMPLOYEE", "attendance.self.read"],
      ["LINE_MANAGER", "attendance.team.read"],
      ["MANAGER", "attendance.management.read"],
    ];
    for (const [role, legacyPermission] of lowerRoles) {
      expect(canAccessRoute(session([role], [legacyPermission]), "Attendance")).toBe(false);
    }

    expect(canAccessRoute(session(["EMPLOYEE"], ["payroll.self.read_payslip"]), "Payroll")).toBe(true);
    expect(canAccessRoute(session(["EMPLOYEE"], []), "Payroll")).toBe(false);
    expect(canAccessRoute(session(["HR"], ["attendance.hr.read"]), "Attendance")).toBe(true);
    expect(canAccessRoute(session(["CPO"], ["attendance.read_all"]), "Attendance")).toBe(true);
    expect(canAccessRoute(session(["COO"], ["attendance.read_all"]), "Attendance")).toBe(true);
  });'''
authorization_test.write_text(
    authorization_source[: -len(marker)] + new_frontend_test + marker,
    encoding="utf-8",
)

# Backend RBAC regression coverage.
replace_once(
    "backend/scripts/rbac-regression.js",
    "  assert.equal(employee.has('payroll.self.read_payslip'), false, 'EMPLOYEE must not access payroll');",
    "  assert.equal(employee.has('payroll.self.read_payslip'), true, 'EMPLOYEE requires access to own published payslips');",
)
replace_once(
    "backend/scripts/rbac-regression.js",
    "  assert.equal(manager.has('leave.team.approve_line_manager'), false);\n  assert.equal(hr.has('leave.hr.approve'), true);",
    """  assert.equal(manager.has('leave.team.approve_line_manager'), false);
  for (const role of [employee, lineManager, manager]) {
    for (const permission of [
      'attendance.self.read', 'attendance.self.create', 'attendance.self.correct_request',
      'attendance.team.read', 'attendance.team.review',
      'attendance.management.read', 'attendance.management.review',
    ]) assert.equal(role.has(permission), false, `attendance must remain private below HR: ${permission}`);
  }
  assert.equal(hr.has('leave.hr.approve'), true);""",
)
rbac_test = ROOT / "backend/scripts/rbac-regression.js"
rbac_source = rbac_test.read_text(encoding="utf-8")
insertion_anchor = "test('every permission is assigned and protected permissions are explicit', () => {"
if insertion_anchor not in rbac_source:
    raise SystemExit("RBAC insertion anchor missing")
exact_role_test = r'''test('payroll role decorators honour exact role lists while preserving employee self-service', () => {
  const guard = fs.readFileSync(path.join(backendSource, 'modules/authorization/permissions.guard.ts'), 'utf8');
  assert.doesNotMatch(guard, /hasPayrollRole/u);
  assert.match(guard, /payrollRoles\.some\(\(role\) => user\.roles\.includes\(role\)\)/u);

  const controller = fs.readFileSync(path.join(backendSource, 'modules/payroll/payroll.controller.ts'), 'utf8');
  const classHeader = controller.slice(0, controller.indexOf('export class PayrollController'));
  assert.doesNotMatch(classHeader, /@PayrollRoles/u, 'class-level role gate must not block employee-owned payslips');
  assert.match(controller, /@Permissions\('payroll\.self\.read_payslip'\)\s+@Get\('payslips\/me'\)/u);
});

'''
rbac_test.write_text(
    rbac_source.replace(insertion_anchor, exact_role_test + insertion_anchor, 1),
    encoding="utf-8",
)

# Additive UI refinement after the canonical design system.
replace_once(
    "src/main.tsx",
    'import "./styles.css";',
    'import "./styles.css";\nimport "./production-polish.css";',
)

(ROOT / "src/production-polish.css").write_text(
    dedent(
        r'''/*
 * Production visual polish
 * Restrained Apple-inspired surfaces, consistent alignment and MedTech branding.
 * Presentation only: workflow and authorization remain server-owned.
 */
:root {
  --control-radius: 10px;
  --card-radius: 18px;
  --layout-gap: 18px;
  --page-gutter: clamp(18px, 2.2vw, 32px);
  --clinical-shadow: 0 1px 2px rgba(23, 33, 58, 0.035), 0 10px 28px rgba(23, 33, 58, 0.055);
  --clinical-shadow-raised: 0 18px 42px rgba(23, 33, 58, 0.1);
  --motion-standard: 170ms cubic-bezier(.22, .61, .36, 1);
}

html {
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

body,
.app {
  background: var(--canvas);
  letter-spacing: -0.006em;
}

.sidebar {
  background: linear-gradient(180deg, #223168 0%, #18244f 54%, #111b38 100%);
  box-shadow: 1px 0 0 rgba(255, 255, 255, 0.06);
}

.brand-block,
.sidebar-profile,
.sidebar-footer {
  border-color: rgba(255, 255, 255, 0.09);
}

.panel,
.login-card,
.workspace-gate-card,
.table-wrap,
.workflow-disclosure {
  border-color: color-mix(in srgb, var(--border) 88%, transparent);
  border-radius: var(--card-radius);
  box-shadow: var(--clinical-shadow);
}

.panel,
.table-wrap,
.workflow-disclosure {
  background: var(--surface);
}

.panel-head {
  align-items: flex-start;
  gap: 16px;
}

.panel-head h2,
.panel-head h3,
.page-head h1,
.page-header h1 {
  letter-spacing: -0.025em;
  line-height: 1.15;
}

.panel-head > :last-child,
.page-head > :last-child,
.page-header > :last-child {
  flex: 0 0 auto;
}

button,
input,
select,
textarea {
  border-radius: var(--control-radius);
}

button {
  min-height: 40px;
  padding-inline: 14px;
  font-weight: 650;
  box-shadow: none;
}

.app button:hover:not(.scrim) {
  transform: none;
  box-shadow: 0 5px 16px rgba(23, 33, 58, 0.08);
}

button.primary,
.primary {
  background: var(--brand-red);
  border-color: var(--brand-red);
}

input,
select,
textarea {
  min-height: 42px;
  padding: 0.62rem 0.72rem;
}

label {
  gap: 7px;
}

.table-wrap {
  overflow: auto;
}

table {
  border-collapse: separate;
  border-spacing: 0;
}

th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface-subtle);
  color: var(--text-muted);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.045em;
  text-transform: uppercase;
}

th,
td {
  padding: 0.8rem 0.9rem;
  vertical-align: middle;
}

tbody tr:hover td {
  background: color-mix(in srgb, var(--brand-navy) 2.8%, var(--surface));
}

.login-shell {
  background: #f5f5f7;
}

.login-card {
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(23, 33, 58, 0.1);
  backdrop-filter: blur(22px) saturate(125%);
  -webkit-backdrop-filter: blur(22px) saturate(125%);
}

.login-stage {
  filter: saturate(0.78) contrast(0.98);
}

.login-brand img {
  max-width: min(230px, 78%);
}

.login-eyebrow {
  color: var(--brand-plum);
}

.badge,
.status-badge,
.chip {
  border-radius: 999px;
  font-weight: 650;
}

.empty {
  min-height: 96px;
  display: grid;
  place-items: center;
  text-align: center;
}

:root[data-theme="dark"] .login-shell {
  background: var(--canvas);
}

:root[data-theme="dark"] .login-card {
  background: rgba(15, 27, 45, 0.92);
  border-color: rgba(255, 255, 255, 0.09);
}

@media (max-width: 900px) {
  .panel-head,
  .page-head,
  .page-header {
    align-items: stretch;
  }

  .panel-head > :last-child,
  .page-head > :last-child,
  .page-header > :last-child {
    width: 100%;
  }

  .panel-head > :last-child button,
  .page-head > :last-child button,
  .page-header > :last-child button {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
'''
    ).lstrip(),
    encoding="utf-8",
)

# Permanent quality gates. No deployment is performed by CI.
workflow_path = ROOT / ".github/workflows/production-gates.yml"
workflow_path.parent.mkdir(parents=True, exist_ok=True)
workflow_path.write_text(
    dedent(
        r'''name: Production gates

on:
  pull_request:
    branches: [main]
  push:
    branches: [main, agent/production-rbac-ui-hardening]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: production-gates-${{ github.ref }}
  cancel-in-progress: true

jobs:
  frontend:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build

  backend-security-and-rbac:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
      - run: npm run prisma:generate
      - run: npm run build
      - run: npm run test:rbac
      - run: npm run test:security

  browser-ui:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:system-ui

  compose-config:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - run: cp .env.example .env
      - run: docker compose config --quiet
'''
    ).lstrip(),
    encoding="utf-8",
)

(ROOT / "docs/PRODUCTION_READINESS.md").write_text(
    dedent(
        r'''# Production readiness gates

This document records the release gates for the MedTech HR ERP. Passing source-code checks is necessary but does not replace business acceptance or environment verification.

## Enforced in CI

- Frontend unit tests and production TypeScript/Vite build.
- Backend Prisma generation and NestJS build.
- RBAC catalogue/controller-policy regression checks.
- Security regression suite.
- Playwright system UI suite in Chromium.
- Docker Compose configuration validation.

## Authorization invariants

- Attendance is visible only to HR, CPO, COO, and explicitly privileged administrative/audit contexts. Employee, Line Manager, and Manager roles receive no attendance permission or navigation entry.
- Employees may access only their own published payslips. Organization-wide payroll remains restricted to HR/CPO/COO according to read or mutation permissions.
- Admin has platform and approved global-read capabilities but no business approval or payroll-operation permission.
- Super Administrator access remains protected, audited, and subject to the protected-action controls implemented by each workflow.
- Every non-public backend endpoint must carry an explicit permission policy; missing policy fails closed.

## Release checklist

1. All Production gates jobs pass on the exact release commit.
2. Apply Prisma migrations to a staging copy and run backend integration, leave, financial, document-scanning, and provisioning regression suites.
3. Complete authenticated acceptance for Employee, Line Manager, Manager, HR, CPO, COO, Admin, and Super Admin personas.
4. Verify attendance privacy and payslip IDOR protection with direct URL/API attempts, not navigation visibility alone.
5. Verify Microsoft Entra, Graph mail/calendar, private object storage, malware scanning, backups, alert delivery, and Secret Manager values in the target environment.
6. Validate Qatar payroll/WPS output against the current bank-approved SIF specification and a golden sample before enabling production export.
7. Take an application-consistent backup, deploy through the existing `medtech-hr-erp` Compose project, and pass `/healthz` plus `/api/v1/health` checks.
8. Record approvers, deployed commit, migration version, rollback point, and acceptance evidence.

## Non-negotiable external sign-offs

Production status cannot be inferred from source alone. Business workflow owners must approve the role matrix and approval routing; Finance must approve payroll/WPS calculations; HR must approve certificate and employee-data handling; IT/Security must approve identity, secrets, backups, monitoring, and disaster recovery.
'''
    ).lstrip(),
    encoding="utf-8",
)

# One-shot helper removes itself and its workflow before the verified commit.
(ROOT / ".github/workflows/apply-production-hardening.yml").unlink()
Path(__file__).unlink()

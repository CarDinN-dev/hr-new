from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(relative_path: str, old: str, new: str) -> None:
    path = ROOT / relative_path
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected source block not found in {relative_path}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


# The Playwright web-server command must work on Linux CI as well as Windows.
replace_once(
    "playwright.config.ts",
    'command: "npm.cmd run dev -- --host 127.0.0.1 --port 4173 --strictPort",',
    'command: "npm run dev -- --host 127.0.0.1 --port 4173 --strictPort",',
)

# Keep this layer deliberately presentation-only. The canonical stylesheet already
# owns every responsive measurement, focus target, login contrast, and motion token.
# Broad control/layout overrides here previously caused horizontal overflow and
# weakened the dark login contrast, so this file is constrained to non-geometric
# surface refinement only.
(ROOT / "src/production-polish.css").write_text(
    '''/*
 * MedTech production polish
 *
 * A restrained, geometry-safe finishing layer over the canonical clinical design
 * system in styles.css. No component dimensions, breakpoints, navigation widths,
 * login colours, or workflow layout rules are overridden here.
 */

html {
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body,
.app {
  letter-spacing: -0.004em;
}

.app :is(.panel, .metric, .report-card, .employee-card, .template-card, .pipeline-column, .candidate-card, .payroll-tile, .workflow-card, .table-wrap, .workflow-disclosure) {
  border-color: color-mix(in srgb, var(--border) 90%, transparent);
}

.app :is(.panel-head h2, .panel-head h3, .page-head h1, .page-header h1) {
  letter-spacing: -0.025em;
  text-wrap: balance;
}

.app :is(.badge, .status-badge, .chip) {
  font-weight: 700;
}

.app tbody tr td {
  transition: background-color var(--motion-standard);
}

.app tbody tr:hover td {
  background: color-mix(in srgb, var(--brand-navy) 2.6%, var(--surface));
}

:root[data-theme="dark"] .app tbody tr:hover td {
  background: color-mix(in srgb, var(--brand-navy) 14%, var(--surface));
}
''',
    encoding="utf-8",
)

# Lint-clean the existing implementation without altering behaviour.
replace_once(
    "backend/src/common/utils/hybrid-search.util.ts",
    """  const { page: _page, limit: _limit, skip: _skip, take: _take, ...authorizedArgs } = listArgs(
    { ...query, search: undefined },
    options,
  );
""",
    """  const authorizedArgs = listArgs(
    { ...query, search: undefined },
    options,
  );
  delete authorizedArgs.page;
  delete authorizedArgs.limit;
  delete authorizedArgs.skip;
  delete authorizedArgs.take;
""",
)

replace_once(
    "backend/src/modules/employees/employees.service.ts",
    "import { listArgs, paginationMeta } from '../../common/utils/crud.util';\n",
    "",
)

replace_once(
    "backend/src/modules/loans/loans.service.ts",
    "import { listArgs, paginationMeta } from '../../common/utils/crud.util';\n",
    "",
)

replace_once(
    "backend/src/modules/operations/operations.service.ts",
    "      const { interviewAssessment: _interviewAssessment, offerDetails, ...candidateDetails } = dto;",
    "      const { interviewAssessment, offerDetails, ...candidateDetails } = dto;\n      void interviewAssessment;",
)

replace_once(
    "backend/src/modules/operations/operations.service.ts",
    "      const { expectedVersion: _expectedVersion, ...input } = dto;",
    "      const { expectedVersion, ...input } = dto;\n      void expectedVersion;",
)

replace_once(
    "backend/src/modules/operations/recruitment-pdf.ts",
    "return String(value ?? '').replace(/[\\u0000-\\u001f\\u007f]/g, ' ').trim().slice(0, maximum);",
    "return String(value ?? '').replace(/\\p{Cc}/gu, ' ').trim().slice(0, maximum);",
)

replace_once(
    "backend/src/modules/payroll/payroll.service.ts",
    "import { CreatePayrollAdjustmentDto, QueryPayrollAdjustmentsDto, ReconcilePayrollPaymentItemDto } from './dto/payroll-adjustment.dto';",
    "import { CreatePayrollAdjustmentDto, QueryPayrollAdjustmentsDto } from './dto/payroll-adjustment.dto';",
)

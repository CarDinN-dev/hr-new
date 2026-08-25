from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(relative_path: str, old: str, new: str) -> None:
    path = ROOT / relative_path
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected source block not found in {relative_path}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "playwright.config.ts",
    'command: "npm.cmd run dev -- --host 127.0.0.1 --port 4173 --strictPort",',
    'command: "npm run dev -- --host 127.0.0.1 --port 4173 --strictPort",',
)

replace_once("src/production-polish.css", "  --card-radius: 18px;", "  --card-radius: 16px;")

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

# HR ERP Production-Readiness Executive Summary

**Audit date:** 2026-07-13

**Repository:** `CarDinN-dev/hr-new`

**Revision:** `2e833d0aeff3797341e609c6993aa2b16b284450`

**Release recommendation:** **BLOCK**

> This is an evidence-backed preliminary audit produced from four completed independent full-repository reviews. Each completed reviewer closed all 147 authoritative source rows, for 588 completed review receipts. Two additional reviewers did not complete, and centralized validation/attack-path phases were not run. Findings marked “requires runtime confirmation” must not be treated as proven exploits. No application implementation code was changed.

## Readiness scores

| Area | Score / 10 | Basis |
| --- | ---: | --- |
| Overall | **4.1** | Builds and existing tests pass, but confirmed/repeated authorization and financial-integrity defects block release. |
| Security | **4.0** | Strong global JWT/CSRF/validation defaults; material object-scope, seed lifecycle, proxy trust, export, and sensitive-data risks remain. |
| Business logic | **3.0** | Leave duration is client-controlled and multiple balance transitions are race-prone; payroll consumes leave data downstream. |
| UX | **6.0** | Frontend builds and unit tests pass; no browser E2E review was completed. |
| Accessibility | **5.0** | Not enough automated or manual browser evidence; no dedicated axe/Playwright/Cypress suite was found. |
| Backend | **5.0** | Nest build, no-fix lint, Prisma generation, and security regression pass; service-level authorization and transaction gaps remain. |
| Database | **4.0** | Prisma and migrations exist, but critical leave invariants are not enforced atomically at the database boundary. |
| Infrastructure | **5.0** | Compose config is valid and services bind to loopback; production startup reseeds privileged accounts and proxy trust depends on topology. |
| Testing | **5.0** | 19 frontend tests and backend security regression pass; no concurrency, role-matrix E2E, restart-lifecycle, or accessibility coverage proves the reported controls. |

Scores are provisional because runtime UI, disposable PostgreSQL concurrency, migration deployment, container build/health, and browser accessibility checks were not completed.

## Top ten risks

1. **Privileged accounts are reset/reactivated during production restarts.** Compose runs the seed on every API start, and privileged upserts restore credentials/status without incrementing `sessionVersion` (`docker-compose.yml:24-43`, `backend/prisma/seed.ts:14-56`).
2. **Leave balance transitions are not concurrency-safe.** Create, update, decision, and cancellation paths read state before their transaction and apply unconditional mutations (`backend/src/modules/leave/leave.service.ts:121-307`). Independent runtime evidence reproduced oversubscription and double approval.
3. **Leave duration is trusted from the client.** `totalDays` is accepted independently of the requested date range and drives balance and payroll accounting (`backend/src/modules/leave/dto/create-leave-request.dto.ts:29-33`, `backend/src/modules/leave/leave.service.ts:117-139`).
4. **Department-targeted announcements cross department boundaries.** Read predicates check time/role but omit department membership (`backend/src/modules/announcements/announcements.service.ts:31-47,75-87`).
5. **Managers can target or retarget announcements beyond their authorized department/audience.** Create/update forwards caller-selected targeting fields without a department-policy check (`backend/src/modules/announcements/announcements.service.ts:18-29,61-67`).
6. **Managers can take over HR-authored performance reviews for direct reports.** Subject authorization is incorrectly treated as authorization to edit the existing review object (`backend/src/modules/performance-reviews/performance-reviews.service.ts:63-88`).
7. **A shared `includeDeleted` query flag exposes soft-deleted records to ordinary roles.** The root query/utility accepts the flag without HR-only authorization and is reused across employee, attendance, announcement, contract, document, leave, payroll, salary, review, department, position, and leave-type lists (`backend/src/common/dto/pagination-query.dto.ts:34-40`, `backend/src/common/utils/crud.util.ts:30-43`).
8. **Sensitive-looking HR/payroll fixture data is compiled into the public frontend bundle.** Public static assets contain employee-like identity, banking, and compensation fields (`src/data.ts:285-430`, `src/main.tsx:188-195,1929-1939`). Final severity depends on whether the records are real.
9. **A plaintext database dump containing HR data and password hashes exists in the OneDrive-backed workspace.** Git ignore rules reduce accidental commits but do not provide encryption or prevent cloud synchronization (`backups/hr_erp-db-backup-20260709-125653.sql:567-681`).
10. **CSV/Excel-compatible payroll exports do not neutralize spreadsheet formulas.** Stored/imported employee values may be interpreted when finance opens an export (`src/payrollExports.ts:6-12,31-80`).

## Baseline results

| Check | Result |
| --- | --- |
| `npm.cmd run test` | Pass: 7 files, 19 tests. |
| `npm.cmd run build` | Pass; warning for a 527.60 kB minified `LoginScene` chunk. |
| `backend: npm.cmd run prisma:generate` | Pass. |
| `backend: npm.cmd run build` | Pass. |
| `backend: npm.cmd run test:security` | Pass; expected internal error marker was logged by the regression script. |
| `backend: npx.cmd eslint "{src,prisma}/**/*.ts"` | Pass with no output; no autofix was used. |
| Root/backend `npm.cmd audit --omit=dev --audit-level=high` | Pass: zero reported production dependency vulnerabilities. |
| `docker compose config --quiet` | Pass. |
| Docker build/up/health | Not run: the persistent PostgreSQL volume was not proven disposable. |
| Browser E2E/accessibility | Not run; no Playwright/Cypress/axe suite was found. |

## Immediate next steps

1. Remove production seeding from normal startup and create a one-time, explicitly invoked bootstrap path that never reactivates or resets existing privileged accounts.
2. Move all leave balance checks and transitions into database-enforced atomic operations with concurrency regression tests; derive `totalDays` server-side from an approved calendar policy.
3. Centralize authorization predicates for announcement department/audience scope, performance-review ownership, and soft-deleted record visibility.
4. Remove sensitive data from client bundles and cloud-synced plaintext backups; rotate affected credentials if the dump left a controlled encrypted location.
5. Neutralize formula prefixes in every spreadsheet/CSV export and add regression fixtures.
6. Run the P0/P1 verification suite in `FIX_PLAN.md` against a disposable PostgreSQL database, then perform four-role API and browser tests.

Implementation can begin safely in isolated, reviewed P0 batches. Production deployment cannot proceed safely until the P0/P1 findings are resolved and verified.

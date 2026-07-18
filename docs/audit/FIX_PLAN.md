# HR ERP Remediation Plan

**Revision audited:** `2e833d0aeff3797341e609c6993aa2b16b284450`

**Rule:** Do not start P2/P3 while a reproducible P0/P1 issue remains. Every implementation batch must independently re-verify the finding, add a regression test, make the smallest root-cause fix, and record results in `docs/audit/REMEDIATION_LOG.md`.

## P0 — Release blockers

### P0-A: Make production bootstrap safe (`FS-002`)

Remove `npm run seed` from the normal API startup command in `docker-compose.yml`. Change `backend/prisma/seed.ts` so normal boot cannot update/reactivate an existing privileged identity. Provide an explicit one-time bootstrap command that creates missing initial accounts only, fails closed when an identity already exists, and never resets password, role, permissions, `isActive`, `deletedAt`, or `sessionVersion`.

Expected files: `docker-compose.yml`, `docker-compose.production.yml`, `backend/package.json`, `backend/prisma/seed.ts`, bootstrap/security regression tests, deployment documentation. Expected migration: none. Data consideration: preserve all existing accounts; do not automatically reconcile them. Rollback: restore the prior startup command only in a disposable environment, never production.

Acceptance evidence: restart a disposable API/database after disabling, deleting, and rotating a seeded admin; every state remains unchanged. Prove a previously issued JWT is invalidated when an administrator explicitly revokes sessions. Prove a fresh empty database can be bootstrapped once and a second bootstrap fails without mutation.

### P0-B: Make leave duration authoritative (`FS-003`)

Stop accepting `totalDays` as an independent authority. Derive it server-side from `startDate`, `endDate`, half-day flags, approved holidays/weekends, and the documented HR policy. If the client still sends a preview value, ignore or compare it and reject a mismatch. Route payroll unpaid-leave calculations through the same stored authoritative value.

Expected files: leave DTOs/service, a small shared calendar/policy function if one already exists, payroll service callers, frontend request/types/messages, unit and API tests. Migration: normally none; if legacy rows are inconsistent, create a forward-only audit/backfill migration after HR defines the correction policy. Rollback: do not rewrite historical rows without an approved reconciliation export.

Acceptance evidence: long spans with `totalDays=0.5` are rejected or normalized; half-day, single-day, weekend/holiday, cross-month, and timezone-boundary cases match the approved policy; payroll uses the same value.

### P0-C: Close all leave balance races (`FS-004`–`FS-007`)

Move the authoritative request/balance reread, capacity/status check, and mutation into one database transaction. Use a supported serializable transaction with bounded retry and conditional state updates (`updateMany` with expected status/version) so exactly one transition wins. Do not rely on a JavaScript lock or a read performed before `$transaction`. Keep balance increments/decrements and request status in the same commit.

Expected files: `backend/src/modules/leave/leave.service.ts`, focused concurrency test harness/API tests, possibly Prisma schema/migration only if an explicit version column or constraint is proven necessary. Data consideration: first detect negative/divergent balances and reconcile them manually; do not silently clamp production data. Rollback: transaction-only code can be rolled back; any added version column should remain harmless and nullable/defaulted during rollback.

Acceptance evidence: parallel create requests cannot exceed entitlement; parallel updates leave `pendingDays` equal to stored pending requests; duplicate decisions/cancellations produce one success and one conflict without a second balance mutation; approve-vs-cancel races preserve a single valid final state; injected failures roll back both request and balance.

### P0-D: Contain sensitive data (`FS-001`, `FS-013`)

Replace production frontend defaults with an empty non-sensitive state loaded only after authorization. Move fixtures to test/dev-only modules that are not statically imported by the production entry. Determine whether embedded identities are real; if so, treat as a data incident. Remove plaintext database dumps from cloud-synced/source workspaces, store encrypted backups in an approved location, restrict access, and rotate any exposed credentials when required.

Expected files: `src/main.tsx`, `src/data.ts` or replacement test fixtures, tests, `.gitignore`, `.dockerignore`, backup scripts/docs. Migration: none. Data/rollback: preserve the authoritative database; removal of fixtures must not delete production records. Backups must be verified before deleting any only copy.

Acceptance evidence: production build string scan contains no fixture identity, salary, bank/account, or candidate values; unauthenticated assets contain no HR records; backup inventory is encrypted/access-controlled; restore from the approved backup succeeds in a disposable database; secret/hash rotation decisions are documented.

## P1 — High security and integrity

### P1-A: Centralize announcement policy (`FS-008`, `FS-009`)

Create one service-level access predicate used by list and detail reads that combines active dates, audience role, and caller department. For manager create/update, derive or strictly constrain `departmentId` and allowed audiences from the manager's employee profile; never accept privileged targeting solely from the DTO. Preserve SA/HR override explicitly.

Expected files: announcement service/DTO/controller tests and four-role API fixtures. Migration: none. Acceptance evidence: EMP/MGR cannot read another department's targeted row; MGR cannot create or retarget outside policy; SA/HR positive controls pass; list and detail return identical authorization decisions.

### P1-B: Preserve performance-review ownership (`FS-010`)

Authorize updates against the existing review object: non-HR managers may edit only a review they are the recorded reviewer for and whose subject remains a current direct report. Do not rewrite `reviewerId` as a side effect of update. Treat reassignment as a separately authorized HR action if required.

Expected files: performance-review service/DTO and API tests. Migration: none unless existing corrupted attribution needs a reviewed correction script. Acceptance evidence: a manager cannot patch an HR/other-manager review for a direct report; the original reviewer remains unchanged; own-review and HR controls pass.

### P1-C: Make deleted-record access privileged (`FS-011`, `FS-012`)

Remove `includeDeleted` from the shared public pagination DTO or gate it before building Prisma args. Prefer a separate HR-only audit/restore query contract. Ensure detail, list, report, relation, and aggregate paths apply the same deletion predicate; specifically make attendance summary exclude deleted rows by default.

Expected files: `backend/src/common/dto/pagination-query.dto.ts`, `backend/src/common/utils/crud.util.ts`, affected services/controllers, authorization tests. Migration: none. Acceptance evidence: `includeDeleted=true` is rejected or ignored for EMP/MGR across every affected resource; HR-only access is explicit; attendance aggregates change when a row is soft-deleted; ordinary detail routes cannot retrieve deleted IDs.

### P1-D: Neutralize spreadsheet formulas (`FS-014`)

Add one small export-cell function that first neutralizes leading formula characters (`=`, `+`, `-`, `@`, including leading whitespace/control characters according to the supported spreadsheet policy) and then applies CSV or HTML escaping. Reuse it for SIF CSV and Excel-compatible HTML paths.

Expected files: `src/payrollExports.ts`, `src/payrollExports.test.ts`, any other export helpers found by caller search. Migration: none. Acceptance evidence: malicious name/bank/account fixtures remain literal text in the supported spreadsheet application; ordinary Arabic/English/numeric values and SIF format stay valid.

## P2 — Reliability, abuse resistance, UX, accessibility, and performance

### P2-A: Harden login abuse controls (`FS-015`–`FS-017`)

Replace attacker-refreshable account lockout with a policy that slows abuse without indefinitely denying the legitimate account; consider progressive delay, durable/shared counters, alerts, and an operator recovery path. Perform a dummy bcrypt comparison for missing/inactive accounts. Define the trusted-proxy topology: accept Cloudflare client identity only from a verified edge/path, otherwise overwrite with the direct peer address. Do not weaken the per-account control while fixing proxy identity.

Expected files: auth service/tests, `backend/src/main.ts`, `nginx.conf`, Compose/tunnel documentation. Migration: none unless durable counters use a database table; prefer an existing datastore before adding infrastructure. Runtime dependency: intended Cloudflare/direct-LAN topology must be confirmed. Acceptance evidence: timing distributions for existing/missing accounts are not practically distinguishable; rotating `CF-Connecting-IP` on a direct request cannot rotate `request.ip`; legitimate users cannot be held locked indefinitely by repeated remote failures.

### P2-B: Browser role, accessibility, and responsive verification

Add a minimal browser suite covering SA, HR, MGR, and EMP navigation; forbidden routes; session expiry; loading/error/empty states; double-submit prevention; destructive confirmations; mobile tables; keyboard order; visible focus; modal focus trap/restore; labels; and automated accessibility checks. Fix only reproduced issues.

Expected files: browser-test configuration/specs and the smallest affected components/styles. New dependency: only if the project has no browser runner and the team approves one. No database migration. Acceptance evidence: tests pass at desktop and mobile viewports; keyboard-only critical workflows work; automated high-impact accessibility violations are zero.

### P2-C: Reduce the oversized entry chunk (`FS-018`)

Use existing dynamic-import capability to defer PDF/spreadsheet/login-scene or other heavy modules from the initial path. Avoid speculative bundler configuration until bundle analysis identifies the actual contributor.

Expected files: a small number of frontend imports/routes and build tests. Acceptance evidence: production build passes without the current 527.60 kB chunk warning or with a documented justified threshold; login and payroll/PDF flows still work.

## P3 — Hardening and maintainability

After P0/P1 closure, add structured correlation IDs and security-relevant audit events without sensitive payloads; document backup retention/restore ownership; define whether permissions will supplement roles and then either apply them consistently or remove misleading unused claims; add migration-on-clean and migration-on-representative-copy CI; pin deployment image digests according to the team's update process; document resource limits and graceful shutdown; and close remaining UI/operational findings only when reproduced.

## Verification commands

Inspect scripts before running them. The repository's `backend` lint script uses `--fix`, so use the non-mutating command shown here for audit verification.

```powershell
npm.cmd run test
npm.cmd run build

Push-Location backend
npm.cmd run prisma:generate
npm.cmd run build
npm.cmd run test:security
npx.cmd eslint "{src,prisma}/**/*.ts"
npm.cmd audit --omit=dev --audit-level=high
Pop-Location

npm.cmd audit --omit=dev --audit-level=high
docker compose config --quiet
git diff --check
git status --short
```

Only after confirming a disposable database and volume:

```powershell
docker compose build
docker compose up -d
docker compose ps
```

Then run clean-database migrations, representative-copy migrations, four-role API/browser tests, leave concurrency tests, restart/bootstrap tests, backup restore, formula-export fixtures, and an explicit diff review. Do not claim deployment readiness for any check that was not run.

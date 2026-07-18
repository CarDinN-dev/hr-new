# MedTech HR ERP handover

## Start here

- Read `AGENTS.md` first. Ponytail full mode is the default for this workspace.
- The user explicitly asked not to use or generate images for project work.
- Keep unrelated workspace changes intact. At handover time, `AGENTS.md` and `docs/` are untracked and must not be staged unless the user explicitly asks.
- Never commit `.env`, backups, tunnel runtime files, generated PDFs, screenshots, or logs.

## Current state

- Repository: `https://github.com/CarDinN-dev/hr-new`
- Branch: `main`
- Latest application commit: `858bec4 Improve employee entry fields`
- Last checked application tests: `24 passed`; `npm.cmd run build` passed.
- The latest change makes Full Name populate First Name and Last Name, and turns fixed employee fields into selects. The shared normalizer also fills missing name parts for imports and other creation paths.

## Stack and architecture

| Area | Technology | Main files |
| --- | --- | --- |
| Frontend | React 19, TypeScript, Vite, Nginx | `src/main.tsx`, `src/styles.css` |
| Frontend domain | Pure state/business logic | `src/data.ts`, `src/domain.ts` |
| Exports/imports | HTML/XLS-style exports and employee imports | `src/payrollExports.ts`, `src/employeeSheet.ts`, `src/attendanceSheet.ts` |
| Documents | jsPDF generation | `src/pdf.ts` |
| API | NestJS, Prisma, JWT, RBAC | `backend/src`, `backend/prisma/schema.prisma` |
| Persistence | PostgreSQL-backed protected console-state snapshot | `src/api.ts`, `backend/src/modules/console-state` |
| Deployment | Docker Compose, Nginx reverse proxy | `docker-compose.yml`, `docker-compose.production.yml`, `nginx.conf` |

`src/main.tsx` owns the application shell and feature views. Keep UI-only changes there unless a shared business rule belongs in `src/domain.ts` or `src/data.ts`.

`HrState` in `src/data.ts` is the frontend feature-state contract: employees, attendance, leave, payroll, loans, trips, expenses, recruitment, EOS, documents, and settings. `src/api.ts` loads and saves this state through `/api/v1/console-state` after login. The old local storage key is cleared on app startup; PostgreSQL-backed console state is the production source of truth.

## Important business rules

- Attendance codes: `P` present, `H` half-day, `L` approved leave, `A` absent. Set and approve attendance through helpers in `src/domain.ts`.
- Payroll: `createPayroll` calculates LOP as absent days + half of each half-day + unpaid leave. LOP is monthly salary / 30. Finalized slips are not recalculated.
- Loans: `Duration`, `Monthly limit`, and `Manual` repayment modes exist. Automatic deductions honour the company cap, manual overrides are supported, and repayments post only on payroll finalization. Keep `loanDeduction` and `loanDeductions` synchronized.
- Payroll display/export includes loan type/reference details through `payrollLoanDetails`. Department XLS export uses `payrollSlipsForDepartment`; WPS/SIF remains company-wide.
- Employee edits always pass through `upsertEmployee` and `normalizeEmployee`. `splitEmployeeName` is the shared Full Name parser. Do not reimplement name parsing in other flows.
- Employee select values live in `employeeFieldOptions` in `src/main.tsx`; Department options come from `state.settings.departments`. The editor preserves existing imported values that are not in the predefined list.
- Leave approval creates `L` attendance entries and updates leave balances. Deleting/rejecting an approved leave reverses those effects.

## Authentication and security

- The frontend logs in through `/api/v1/auth/login` and stores the session token/CSRF token in `sessionStorage`.
- The backend uses global JWT and role/permission guards. Do not loosen these when adding a UI feature.
- Nginx serves the frontend, proxies `/api/` to the API container, exposes `/healthz`, and deliberately blocks debug, API-documentation, backup, and hidden-file paths in production.
- Secrets are only in the gitignored root `.env`. Required names are in `.env.example`; never put their values in documentation, Git, or chat output.

## Local development and verification

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run dev
```

Open `http://localhost:5173`. The production Compose ports are loopback-only: frontend `8080`, API `3100`, PostgreSQL `5434`.

For backend-only changes:

```powershell
cd backend
npm.cmd run prisma:generate
npm.cmd run build
npm.cmd run test:security
```

The Chrome bridge has previously failed during setup with `Cannot redefine property: process`. Do not claim browser visual QA if that remains unresolved; run the available unit/build checks and report the bridge limitation plainly.

## Production / Google Cloud

- Google Cloud project: `hr-erp-502412`; VM: `hrerp1` in `me-central1-b`.
- Connect only with `gcloud compute ssh hrerp1 --project=hr-erp-502412 --zone=me-central1-b --tunnel-through-iap`. Do not use or deploy to an Oracle server.
- Server account: the OS Login identity; application directory: `/opt/medtech-hr-erp`.
- Compose project name: `medtech-hr-erp`.
- Expected Compose containers: `medtech-hr-erp-hr-erp-1`, `medtech-hr-erp-api-1`, `medtech-hr-erp-postgres-1`, and `medtech-hr-erp-clamav-1`.
- Expected persistent volume: `medtech-hr-erp_postgres_data`.
- The persistent Cloudflare service is the public edge; it is not a second Compose stack and must not be restarted for an application-only deployment.
- Do not create another Compose project or run a second copy of the app.

The tracked `ops/` directory is the canonical source for the deployed secret loader, backup/monitor jobs, and systemd units. Sync reviewed application and `ops/` changes through IAP to a unique `/tmp` release directory, install them into `/opt/medtech-hr-erp` without overwriting `.env`, then run:

```sh
sudo install -m 755 /opt/medtech-hr-erp/ops/production.sh /usr/local/sbin/medtech-hr-erp-production
sudo install -m 755 /opt/medtech-hr-erp/ops/backup.sh /usr/local/sbin/medtech-hr-erp-backup
sudo install -m 755 /opt/medtech-hr-erp/ops/health-monitor.sh /usr/local/sbin/medtech-hr-erp-monitor
sudo env DEPLOYED_COMMIT="$(git rev-parse HEAD)" /usr/local/sbin/medtech-hr-erp-production deploy
```

Install changed unit files with `sudo install -m 644 ops/systemd/* /etc/systemd/system/`, then run `sudo systemctl daemon-reload` and restart only the changed timer/service. Leave PostgreSQL and the Cloudflare service untouched unless their own configuration changed.

The production script reads secret values from Google Secret Manager into a temporary root-only runtime environment, creates an application-consistent backup, applies Prisma migrations, rebuilds the affected API/frontend containers, and rolls application images back if health checks fail.

Verify every deployment:

```sh
curl -fsS http://127.0.0.1/healthz
curl -fsS http://127.0.0.1:3100/api/v1/health
sudo docker ps --filter 'label=com.docker.compose.project=medtech-hr-erp'
sudo systemctl is-active medtech-hr-erp-backup.timer medtech-hr-erp-monitor.timer medtech-hr-erp-cloudflared.service
```

The public Cloudflare Quick Tunnel URL is temporary. Inspect the GCP service status rather than assuming a previously recorded URL remains valid.

## Recent completed work

| Commit | Change |
| --- | --- |
| `858bec4` | Full Name synchronization and employee editor dropdowns |
| `633ce8e` | Loan type/reference shown in payroll register, payslip editor, and XLS |
| `81f4cf2` | Department-specific payroll XLS export |
| `f8ad855`, `dbabf39` | Premium responsive light/dark UI refresh |
| `90f8cea` | Employee loans, automatic/manual deductions, installment modes |
| `65bdbb4`, `2e833d0` | Attendance dashboard totals and payroll LOP fixes |

## Safe next-chat workflow

1. Run `git status --short` and preserve unrelated changes.
2. Read the files that own the requested flow before editing.
3. Run the smallest relevant test plus `npm.cmd run build` for frontend changes.
4. Stage only the requested files, commit, and push `main` when the user asks.
5. Deploy through the existing `medtech-hr-erp` Compose project, then run both health checks and verify exactly one frontend/API/PostgreSQL container set.

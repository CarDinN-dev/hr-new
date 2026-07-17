# HR ERP Production Readiness Report

Report date: 17 July 2026

Decision: **BLOCK production sign-off**

Deployed application revision: `85aa0ea3f5644732f63b4a83b8bcf6a27b2d58c9`

GitHub branch: `codex/complete-hr-erp-remediation`

Draft pull request: <https://github.com/CarDinN-dev/hr-new/pull/1>

Production: Google Cloud project `hr-erp-502412`, VM `hrerp1`, existing `/opt/medtech-hr-erp` Compose project
Public endpoint: <https://resulted-supporting-alone-limitation.trycloudflare.com/>

## Executive decision

The requested role-assignment flow and the planned technical hardening are implemented, tested, published, and deployed. The running revision is healthy, its selected source hashes match the committed release archive, and the external VM application/database ports remain closed.

Production sign-off remains blocked by business data and acceptance gates rather than an unresolved deployment failure. The reporting hierarchy is incomplete, two leave approval policies have invalid primary approvers, the monitoring email channel has not been delivery-verified, and the full authenticated eight-role browser matrix has not been signed off. The single-VM Quick Tunnel design also cannot provide a 10/10 availability rating.

## Deployed role-assignment flow

The System access/settings page now contains a native, responsive visual assignment flow for active login users. It is rendered only for active `ADMIN` or `SUPER_ADMIN` sessions. It makes `EMPLOYEE` mandatory, enforces `MANAGER` implies `LINE_MANAGER`, allows the operational `HR` role, preserves all custom and locked roles, shows additions/removals/effective access before confirmation, requires an audit reason, and warns that sessions will be revoked. `CPO`, `COO`, `ADMIN`, and `SUPER_ADMIN` are displayed as locked and cannot be changed through this flow.

The backing `PUT /api/v1/system/users/:id/role-flow` endpoint requires `role.assign` plus an active `ADMIN` or `SUPER_ADMIN` role. Direct permission overrides alone are insufficient. The server rejects invalid/duplicate codes, missing `EMPLOYEE`, invalid manager-role combinations, self-assignment, and stale authorization versions. It resolves active role IDs server-side and delegates to the existing audited role-assignment transaction, preserving non-flow roles while retaining target notification, authorization-version increment, audit before/after values, and active-session revocation.

No database table, migration, graph dependency, or parallel authorization model was added. Role assignment does not change `Employee.managerId`; reporting-line changes remain in the separate preview-first, step-up-protected hierarchy workflow. No production employee roles were changed merely to prove the deployment.

## Verification evidence

| Area | Result |
|---|---|
| GitHub | Deployed application commit `85aa0ea`; draft PR #1; GitHub remote head verified |
| Release archive | Targeted committed-source archive for `85aa0ea` transferred through IAP and extracted without touching production `.env` |
| Deployment | Guarded deployment `20260717T093313Z` passed preflight, backup, build, migration, local API, and web health gates |
| Microsoft restoration | Entra callback updated and guarded configuration deployment `20260717T075244Z` passed; live providers report `microsoft: true` |
| Images | API `670e6556b8e6c70ade58c20bb80db4dca9947281a201cb62dc0e1330e83d882f`; web `936aec314e86831f44c282595cd9bde107f74ad793afe26ee22626bacebc2df5` |
| Database | 15 migrations found; schema up to date; no pending migrations |
| Runtime | PostgreSQL, API, web, and ClamAV all running healthy with zero restarts |
| Public smoke | `/`, `/healthz`, and `/api/v1/health` returned HTTP 200 |
| Security headers | HSTS, CSP, Permissions-Policy, Referrer-Policy, `nosniff`, and frame denial present |
| Microsoft OIDC | Live start returned 302 to the correct single-tenant authorization endpoint with exact callback, PKCE S256, state, nonce, no-store caching, and a secure HttpOnly transaction cookie; malformed callback failed closed to `?microsoft=denied` |
| Authorization probe | Unauthenticated role-flow mutation returned HTTP 401 |
| Network exposure | VM ports 22, 80, 443, 3000, and 5432 were closed from the external probe; web remains loopback-bound |
| Source integrity | Deployed service, save-before-period-load guard, and live-punch query markers confirmed directly on the VM after release |

The first deployment preflight caught Windows CRLF line endings in shell scripts before any container or database change. A repository `.gitattributes` rule now forces `*.sh` to Linux LF. The corrected archive passed Bash parsing and production preflight before deployment.

## Automated test evidence

- Frontend: production build passed; 12 test files and 43 tests passed.
- Backend security: 25 tests passed, including Admin/Super Admin allow rules, other-role/direct-permission-only denial, invalid codes, self-assignment, stale versions, locked-role preservation, audit recording, notification, session revocation, and attendance-approval persistence.
- RBAC: 9 tests passed. Microsoft provisioning: 4 tests passed. Financial regression: passed.
- Disposable PostgreSQL integration: clean isolated database, migrations, and integration regression passed on the VM without touching production data.
- Prisma validation, backend lint, Compose validation, and `git diff --check` passed.
- Frontend and backend dependency audits reported zero known vulnerabilities.
- An isolated encrypted-backup restore drill, migrations, health smoke, and financial-consistency regression passed during the remediation program.

The authenticated Chrome-profile bridge was unavailable during the final deployment run because of an internal browser-runtime conflict. Therefore this report does not claim completion of the required Admin/Super Admin/HR/Manager/Employee desktop and mobile browser matrix. Automated UI and authorization coverage passed, but authenticated browser acceptance remains a production gate.

## Attendance remediation release

The attendance release corrects the approval persistence defect: `PATCH /attendance/:id` now retains `approvalStatus` and records the before/after approval value in the audit event. Half-day and absent rows continue to require review after a refresh unless they are approved; ordinary present and leave rows no longer appear as “Not approved.” Rejected rows remain visibly unapproved and can be reassessed by an authorized reviewer.

The page now loads the selected day’s server attendance records to display actual punch-in, punch-out, worked-hour, and late-arrival values rather than inventing attendance times. When a manager changes date or month, pending local changes are synchronously saved through the existing queue before a server period replaces the viewport state. Attendance synchronization now fetches only the changed date or dates, rather than the complete attendance history. Bulk “mark all” and “clear day” actions require a confirmation and retain leave records.

Release validation on 17 July 2026: frontend production build and all 43 frontend tests passed; backend build, 25 security checks, 9 RBAC checks, and financial regression passed; Prisma validation, both production dependency audits, Compose validation using the example environment, and `git diff --check` passed. The guarded deployment reported 15 current migrations and no pending migration. Four production containers are healthy, application/database ports are loopback-only, the public health endpoint returned HTTP 200, security headers remained present, public providers report `local: true` and `microsoft: true`, and an unauthenticated role-flow mutation returned HTTP 401.

## Cloud and operational controls completed

- SSH ingress is restricted by Google Cloud firewall to IAP `35.235.240.0/20`; default public SSH, RDP, HTTPS, ICMP, and internal ingress rules are disabled. External probes could not open port 22.
- The VM uses a dedicated runtime service account, Shielded VM Secure Boot/vTPM/integrity monitoring, and deletion protection. The default Compute service account no longer has broad Editor access.
- PostgreSQL, JWT, audit HMAC, Microsoft client, and provisioning secrets are loaded from Secret Manager into a root-only runtime file. The project `.env` remains mode `600` and no longer contains those secret values.
- Database backup and runtime identities are separated. Guarded deployments require resource, secret, Compose, health, and backup preflight checks and create an application-consistent backup before rebuilding the two existing application services.
- Rollback image tags are created before deployment; migration or health failures automatically restore the previous API/web images.
- Ops Agent/monitoring covers uptime, API failures, authentication bursts, container/component health, CPU, memory, disk, backup freshness, monitor silence, and malware scanner failures.
- Containers have explicit resource/PID limits, health checks, dropped capabilities, `no-new-privileges`, read-only filesystems where compatible, and loopback-only application bindings.
- Document uploads use signature/magic-byte validation, persisted `PENDING`/`CLEAN`/`REJECTED`/`FAILED` states, asynchronous ClamAV scanning, fail-closed downloads, auditing, and private GCS storage.
- Request correlation IDs are returned on masked errors. Aggregate frontend synchronization now recovers canonical server state after partial failures.

## Live organization-readiness result

Generated from the deployed code against production using a read-only diagnostic on 17 July 2026. `releaseReady` is `false`.

| Violation | Count |
|---|---:|
| Active employees missing a reporting manager | 9 |
| Invalid manager links | 0 |
| Reporting cycles | 0 |
| Managers without an active linked user | 1 |
| Direct managers missing `LINE_MANAGER` | 2 |
| Managers of managers/department heads missing `MANAGER` | 2 |
| Login-enabled employees missing `EMPLOYEE` | 1 |
| Departments without a department manager | 10 |
| Invalid workflow stage policies | 2 |
| Super administrators above the two-account ceiling | 0 |

The invalid workflow policies are the `LEAVE` workflow `CPO` and `COO` primary-approver stages. HR must approve the reporting preview; managers must receive active linked users and appropriate roles; department owners must be assigned; and the two approval routes must be repaired before release sign-off. Manager relationships must not be inferred from job titles.

## Open gates and owners

| Priority | Required work | Owner | Acceptance evidence |
|---|---|---|---|
| P0 | Approve and apply the employee/department reporting hierarchy and correct invalid leave approvers | HR/CPO/COO | Organization-readiness endpoint is clean or every top-level exception is explicitly approved |
| P1 | Complete authenticated desktop/mobile browser acceptance for all eight roles, keyboard flow, stale/failure states, and re-login after revocation | QA with role owners | Signed matrix with no open P0/P1 defects |
| P1 | Verify monitoring notification delivery, not merely channel configuration | Operations | Received test alerts for public uptime, API/component, backup, authentication, resource, and scanner conditions |
| P1 | Approve document/payroll/audit retention periods and align GCS lifecycle/versioning | HR/Legal | Signed schedule and verified bucket lifecycle configuration |
| P1 | Complete a controlled live malware rejection smoke if no approved EICAR evidence is retained | Security administrator | Rejected scan record, audit entry, alert, and blocked download |
| P1 | Decide and test OS Login two-factor enforcement with an administrator access method that supports it | Cloud administrator | Two administrators prove IAP login and recovery without metadata keys |
| Residual | Replace the temporary Quick Tunnel and single VM with a stable endpoint and redundant application/database architecture | Business owner/Cloud architect | Explicitly authorized HA cutover, rollback, failure test, and accepted RPO/RTO |

## Release rule

Production sign-off requires zero open P0/P1 defects or a formally approved, time-bounded exception with an owner and deadline. The existing Compose project, database, and public endpoint must remain unchanged unless a separate cutover is explicitly authorized. Until the hierarchy, workflow, browser, notification, retention, and identity gates above are closed, the honest release decision remains **BLOCKED**.

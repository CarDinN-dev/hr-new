# MedTech HR ERP — Production Readiness Status

## Status

**Code state:** production candidate on `agent/production-readiness-rbac-hardening`.

**Go-live state:** not approved for production deployment until every environment-specific gate in this document is completed in staging and evidenced. A green code pipeline is necessary, but it is not a substitute for configured identity, secrets, storage, backups, observability, WPS validation, and an independent security review.

## Source of truth

The production candidate is the real React/Vite frontend and NestJS/Prisma/PostgreSQL backend in this repository. Standalone mockups, screenshot-only prototypes, and local JSON demos are not production artifacts.

## Authorization baseline

Authorization is enforced at three layers:

1. **Database-backed RBAC catalog** — active role assignments, role inheritance, permission grants, scoped overrides, expiry, revocation, and protection levels.
2. **NestJS server enforcement** — global authentication and permission guards plus record-level scope checks inside services. Frontend visibility is never accepted as authorization evidence.
3. **Frontend capability filtering** — routes, navigation, loaders, and actions are hidden or disabled using the effective permission set returned by the backend.

Deny overrides take precedence over grants for matching scopes. Role inheritance is resolved recursively and rejects cycles. Role or permission changes increment `authorizationVersion`; stale sessions are invalidated. Protected operations require recent step-up authentication, including for `SUPER_ADMIN`.

### Built-in role policy

| Role | Employee data | Leave | Attendance | Payroll | Platform administration |
|---|---|---|---|---|---|
| EMPLOYEE | Self | Request/read/cancel own | **No access** | Own published payslips only | No |
| LINE_MANAGER | Self + direct-report scope | First-stage approval | **No access** | Own published payslips only | No |
| MANAGER | Self + management-tree scope | Manager-stage approval | **No access** | Own published payslips only | No |
| HR | Organization HR scope | HR review/approval/administration | Read/manage all authorized employees | Generate/review/approve/publish per grant | Operational settings only |
| CPO | Executive read scope | CPO-stage approval | Organization read | Executive payroll read/export | No system administration |
| COO | Executive read scope | Final approval; controlled own-flow rule | Organization read | Executive payroll read/export | No system administration |
| ADMIN | Global administrative/read scope | Read/reassignment only; no ordinary business approval | Administrative organization read | No ordinary payroll operation | Users/settings/audit/import according to grants |
| SUPER_ADMIN | Inherited full authorized scope | Overrides only with permission + reason + recent step-up | Full authorized scope | Overrides only with permission + reason + recent step-up | Full protected administration |

Attendance is deliberately absent from EMPLOYEE, LINE_MANAGER, and MANAGER grants. A migration removes legacy lower-role attendance grants from existing databases, increments affected users' authorization versions, and revokes their active sessions.

## Automated release gates

The `Production readiness` GitHub Actions workflow blocks acceptance unless these jobs pass:

- Frontend dependency audit, unit tests, and production build.
- Backend dependency audit, Prisma generation/validation, TypeScript build, ESLint, RBAC policy regression, security regression, financial regression, leave regression, document-scanning regression, Microsoft provisioning regression, and system-user-linking regression.
- Real PostgreSQL integration suite against an isolated schema, including live endpoint assertions that attendance is denied to EMPLOYEE/LINE_MANAGER/MANAGER and retained for HR/CPO/COO/ADMIN/SUPER_ADMIN.
- Chromium end-to-end browser suite with failure traces, screenshots, and video.
- Frontend and backend container builds plus Docker Compose validation.

No failed or skipped required gate may be treated as release approval.

## Mandatory staging and production gates

### Identity and access

- Configure the real Microsoft Entra tenant, enterprise application, redirect URI, app roles, and least-privilege Graph permissions.
- Require MFA/Conditional Access for HR, payroll, administrators, and all protected roles.
- Store application credentials in a managed secret store; do not place secrets in `.env` files, container images, repository variables exposed to forks, or build logs.
- Verify joiner/mover/leaver provisioning, role changes, step-up authentication, session revocation, and emergency-access accounts in staging.
- Complete an owner-approved RBAC matrix review using real MedTech job assignments.

### Data protection

- Use managed PostgreSQL with encryption, private networking, point-in-time recovery, automated backups, retention policy, and a proven restore runbook.
- Configure a private document bucket with uniform bucket-level access, short-lived signed downloads, retention/lifecycle rules, and customer-managed encryption where required.
- Enable and verify malware scanning for every supported upload path; production must fail closed when scanning is unavailable unless an explicitly approved quarantine workflow is used.
- Confirm sensitive fields never appear in application logs, traces, analytics, browser storage, exports outside scope, or error responses.
- Complete retention, legal-hold, deletion, and data-subject procedures with HR/legal ownership.

### Payroll and financial controls

- Obtain the current official Qatar WPS/SIF specification and a bank-approved golden sample. Do not enable WPS export based on an inferred format.
- Validate payroll calculations, rounding, unpaid-day rules, loans, reversals, separation handling, and PDF output against signed HR/Finance acceptance cases.
- Enforce maker-checker separation for payroll generation, approval, publication, payment marking, reversal, and overrides.
- Reconcile a staging payroll run to the authoritative HR/Finance source before go-live.

### Operations

- Terminate TLS at the approved managed edge; replace development/self-signed certificates.
- Configure centralized structured logs, immutable audit retention, metrics, traces, uptime checks, security alerts, failed-job alerts, and on-call ownership.
- Run capacity and load tests using the expected employee count, peak approval periods, report exports, imports, and payroll publication workload.
- Exercise backup restoration, regional/service outage response, rollback, key rotation, compromised-account response, and ransomware recovery.
- Apply branch protection to `main`: pull requests only, required Production readiness checks, no force-push, no direct administrator bypass except documented break-glass procedure.

### Independent assurance

- Complete staging UAT for every built-in role and each workflow transition.
- Complete accessibility review for keyboard use, focus handling, screen readers, contrast, zoom, and mobile breakpoints.
- Complete an independent authenticated penetration test covering IDOR/BOLA, privilege escalation, session fixation, CSRF, XSS, upload abuse, export scope, audit tampering, and business-logic races.
- Resolve all Critical/High findings and formally accept any remaining Medium risk before production approval.

## Deployment sequence

1. Merge only after all required checks pass and review is approved.
2. Deploy to staging with production-equivalent identity, database, object storage, scanning, networking, and observability.
3. Apply Prisma migrations and run RBAC synchronization; verify the attendance-privacy migration and session revocation.
4. Run smoke, RBAC, workflow, payroll reconciliation, document, export, and restore tests.
5. Obtain written HR, Finance, IT, Security, and business-owner sign-off.
6. Back up the target environment and record the rollback image/database migration plan.
7. Deploy during the approved change window; monitor health, authorization denials, error rate, queue depth, email delivery, and audit events.
8. Conduct a post-deployment access review and reconciliation before closing the change.

## Release decision

A release is **GO** only when the code pipeline is green and every applicable staging/production gate above has dated evidence and an accountable owner. Otherwise the release remains **NO-GO**, even when the application starts successfully or screenshots look correct.

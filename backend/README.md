# HR ERP Backend

NestJS API for the MedTech HR ERP using PostgreSQL, Prisma, database-backed RBAC, auditable workflows, exact financial arithmetic, validation, centralized errors, and Docker.

## Stack

- NestJS + TypeScript
- PostgreSQL + Prisma ORM
- JWT authentication with bcrypt password hashing and revocable database sessions
- Database-backed RBAC with `EMPLOYEE`, `LINE_MANAGER`, `MANAGER`, `HR`, `CPO`, `COO`, `ADMIN`, and `SUPER_ADMIN`
- Scoped grants and direct permission overrides for self, reporting-tree, assigned-workflow, employee-wide, and system-wide access
- DTO validation with `class-validator`
- Swagger/OpenAPI at `/api/docs`
- Helmet, CORS, global validation, response envelope, exception filter

## Quick Start

```powershell
npm.cmd install
Copy-Item .env.example .env
# Set DATABASE_URL, JWT_SECRET, AUDIT_HMAC_KEY, the initial administrator,
# private document storage, and CORS_ORIGIN.
npx.cmd prisma migrate dev
npm.cmd run seed
npm.cmd run start:dev
```

API base URL: `http://localhost:3000/api/v1`

Swagger docs: `http://localhost:3000/api/docs` in development, or production only with `ENABLE_SWAGGER=true`.

The seed command synchronizes the permission catalogue and eight built-in roles. It creates one initial Super Administrator only when `INITIAL_SUPER_ADMIN_EMAIL` and `INITIAL_SUPER_ADMIN_PASSWORD` are supplied and no active Super Administrator exists. Test personas are created only when `SEED_TEST_PERSONAS=true`; production should leave it disabled. Passwords must be 12-72 bytes with uppercase, lowercase, and number characters.

## Environment

Create `.env` from `.env.example` and set:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hr_erp?schema=public
JWT_SECRET=replace-with-a-long-random-secret
AUDIT_HMAC_KEY=replace-with-a-separate-long-random-secret
JWT_EXPIRES_IN=1d
BCRYPT_SALT_ROUNDS=12
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
GCS_DOCUMENTS_BUCKET=replace-with-private-documents-bucket
INITIAL_SUPER_ADMIN_EMAIL=admin@example.com
INITIAL_SUPER_ADMIN_PASSWORD=replace-with-a-strong-bootstrap-password
SEED_TEST_PERSONAS=false
```

## Docker

The production Compose file is in the repository root and runs the frontend, API, and PostgreSQL as one project:

```powershell
Set-Location ..
docker compose up -d --build
docker compose run --rm --env-from-file .env api npm run seed # first installation only
```

## Core Routes

- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `GET /api/v1/auth/sessions`
- `POST /api/v1/auth/step-up/local`
- `POST /api/v1/auth/logout-all`
- `GET /api/v1/employees`
- `GET /api/v1/employees/me`
- `POST /api/v1/attendance/check-in`
- `POST /api/v1/attendance/check-out`
- `GET /api/v1/attendance/reports/summary`
- `POST /api/v1/leave/submit`
- `GET /api/v1/leave/mine`
- `GET /api/v1/leave/inbox`
- `POST /api/v1/leave/:id/approve`
- `POST /api/v1/service-requests`
- `GET /api/v1/service-requests/:id/download`
- `POST /api/v1/payroll/runs`
- `POST /api/v1/payroll/runs/:id/submit`
- `POST /api/v1/payroll/runs/:id/publish`
- `GET /api/v1/payroll/payslips/me`
- `GET /api/v1/approvals/inbox`
- `GET /api/v1/notifications`
- `GET /api/v1/audit/events`
- `GET /api/v1/system/roles`
- `GET /api/v1/documents`
- `GET /api/v1/announcements`

Every list endpoint supports pagination with `page`, `limit`, `search`, `sortBy`, `sortOrder`, and relevant module filters.

## Security Notes

- Password hashes are never returned.
- Failed-login throttles are persisted in PostgreSQL and enforced by account and client IP.
- JWT sessions are individually revocable and invalidated when authorization or account state changes.
- Authentication and permission guards are global and default-deny; only explicit `@Public()` health and authentication entry points bypass them.
- Controllers declare exact permissions, while services independently enforce self, direct-report, management-tree, assigned-approval, employee-wide, and system-wide resource scopes.
- Direct permission denies take precedence over grants except for the protected built-in Super Administrator.
- Protected role assignment and workflow overrides require recent step-up authentication.
- Sensitive transitions require optimistic versions and idempotency keys and commit with their audit events transactionally.
- Audit records are redacted, HMAC hash-chained, and protected from database updates and deletion.
- Document visibility supports `EMPLOYEE_ONLY`, `MANAGER_AND_HR`, `HR_ONLY`, and `PUBLIC`.

## Prisma

Common commands:

```powershell
npx.cmd prisma generate
npx.cmd prisma migrate dev
npx.cmd prisma studio
npm.cmd run seed
```

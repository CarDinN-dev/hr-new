# HR ERP Backend

NestJS API for the MedTech HR ERP using PostgreSQL, Prisma, JWT authentication, role-based access control, validation, centralized errors, and Docker.

## Stack

- NestJS + TypeScript
- PostgreSQL + Prisma ORM
- JWT authentication with bcrypt password hashing
- Role-based access control: `SUPER_ADMIN`, `HR_ADMIN`, `MANAGER`, `EMPLOYEE`
- DTO validation with `class-validator`
- Swagger/OpenAPI at `/api/docs`
- Helmet, CORS, global validation, response envelope, exception filter

## Quick Start

```powershell
npm.cmd install
Copy-Item .env.example .env
# Set DATABASE_URL, JWT_SECRET, bootstrap passwords and CORS_ORIGIN.
npx.cmd prisma migrate dev
npm.cmd run seed
npm.cmd run start:dev
```

API base URL: `http://localhost:3000/api/v1`

Swagger docs: `http://localhost:3000/api/docs` in development, or production only with `ENABLE_SWAGGER=true`.

The manual bootstrap command creates these accounts only when they do not already exist:

- `hr@med-tech.com`
- `zahira@med-tech.com`
- `kashif@med-tech.com`
- `athul@med-tech.com`

It does not reset passwords, roles, permissions, status, or employee records. Passwords must be supplied through the environment and must be 12-72 bytes with uppercase, lowercase, and number characters.

## Environment

Create `.env` from `.env.example` and set:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hr_erp?schema=public
JWT_SECRET=replace-with-a-long-random-secret
JWT_EXPIRES_IN=1d
BCRYPT_SALT_ROUNDS=12
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
HR_ADMIN_PASSWORD=replace-with-a-strong-password
ZAHIRA_ADMIN_PASSWORD=replace-with-a-strong-password
KASHIF_ADMIN_PASSWORD=replace-with-a-strong-password
ATHUL_ADMIN_PASSWORD=replace-with-a-strong-password
```

## Docker

The production Compose file is in the repository root and runs the frontend, API, and PostgreSQL as one project:

```powershell
Set-Location ..
docker compose up -d --build
docker compose run --rm --env-from-file .env api npm run seed # first installation only
```

## Core Routes

- `POST /api/v1/auth/register` (HR administrator only)
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `GET /api/v1/employees`
- `GET /api/v1/employees/me`
- `POST /api/v1/attendance/check-in`
- `POST /api/v1/attendance/check-out`
- `GET /api/v1/attendance/reports/summary`
- `POST /api/v1/leave/requests`
- `POST /api/v1/leave/requests/:id/decision`
- `POST /api/v1/payroll/generate`
- `GET /api/v1/payroll/payslip/:employeeId?year=2026&month=7`
- `GET /api/v1/documents`
- `GET /api/v1/announcements`

Every list endpoint supports pagination with `page`, `limit`, `search`, `sortBy`, `sortOrder`, and relevant module filters.

## Security Notes

- Password hashes are never returned.
- Failed-login throttles are persisted in PostgreSQL and enforced by account and client IP.
- JWT sessions are revoked when a user logs out or a linked employee is removed.
- JWT guard is global; only `@Public()` auth endpoints bypass it.
- Role guard is global and uses `@Roles()` and `@Permissions()`.
- Employee-scoped modules restrict regular employees to their own records.
- Managers can access direct-report records only where the module allows it.
- HR/admin roles can override employee scoping for operational workflows.
- Document visibility supports `EMPLOYEE_ONLY`, `MANAGER_AND_HR`, `HR_ONLY`, and `PUBLIC`.

## Prisma

Common commands:

```powershell
npx.cmd prisma generate
npx.cmd prisma migrate dev
npx.cmd prisma studio
npm.cmd run seed
```

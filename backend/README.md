# HR ERP Backend

Production-style NestJS backend for HR ERP modules using PostgreSQL, Prisma, JWT auth, RBAC, Swagger, validation, centralized errors, and Docker.

## Stack

- NestJS + TypeScript
- PostgreSQL + Prisma ORM
- JWT authentication with bcrypt password hashing
- Role-based access control: `SUPER_ADMIN`, `HR_ADMIN`, `MANAGER`, `EMPLOYEE`
- DTO validation with `class-validator`
- Swagger/OpenAPI at `/api/docs`
- Helmet, CORS, global validation, response envelope, exception filter

## Quick Start

```bash
npm install
copy .env.example .env
docker compose up -d
npx prisma migrate dev
npx prisma db seed
npm run start:dev
```

API base URL: `http://localhost:3000/api/v1`

Swagger docs: `http://localhost:3000/api/docs` in development, or production only with `ENABLE_SWAGGER=true`.

Seeded users:

- `hr@med-tech.com`
- `zahira@med-tech.com`
- `kashif@med-tech.com`
- `athul@med-tech.com`
- `manager@example.com`
- `employee@example.com`

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
MANAGER_PASSWORD=replace-with-a-strong-password
EMPLOYEE_PASSWORD=replace-with-a-strong-password
```

## Docker

The default compose command starts PostgreSQL only, matching the local development flow:

```bash
docker compose up -d
```

To run the API container too:

```bash
docker compose --profile api up --build
```

## Core Routes

- `POST /api/v1/auth/register`
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
- JWT guard is global; only `@Public()` auth endpoints bypass it.
- Role guard is global and uses `@Roles()` and `@Permissions()`.
- Employee-scoped modules restrict regular employees to their own records.
- Managers can access direct-report records only where the module allows it.
- HR/admin roles can override employee scoping for operational workflows.
- Document visibility supports `EMPLOYEE_ONLY`, `MANAGER_AND_HR`, `HR_ONLY`, and `PUBLIC`.

## Prisma

Common commands:

```bash
npx prisma generate
npx prisma migrate dev
npx prisma studio
npx prisma db seed
```

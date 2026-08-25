# Production readiness gates

This document records the release gates for the MedTech HR ERP. Passing source-code checks is necessary but does not replace business acceptance or environment verification.

## Enforced in CI

- Frontend unit tests and production TypeScript/Vite build.
- Backend Prisma generation and NestJS build.
- RBAC catalogue/controller-policy regression checks.
- Security regression suite.
- Playwright system UI suite in Chromium.
- Docker Compose configuration validation.

## Authorization invariants

- Attendance is visible only to HR, CPO, COO, and explicitly privileged administrative/audit contexts. Employee, Line Manager, and Manager roles receive no attendance permission or navigation entry.
- Employees may access only their own published payslips. Organization-wide payroll remains restricted to HR/CPO/COO according to read or mutation permissions.
- Admin has platform and approved global-read capabilities but no business approval or payroll-operation permission.
- Super Administrator access remains protected, audited, and subject to the protected-action controls implemented by each workflow.
- Every non-public backend endpoint must carry an explicit permission policy; missing policy fails closed.

## Release checklist

1. All Production gates jobs pass on the exact release commit.
2. Apply Prisma migrations to a staging copy and run backend integration, leave, financial, document-scanning, and provisioning regression suites.
3. Complete authenticated acceptance for Employee, Line Manager, Manager, HR, CPO, COO, Admin, and Super Admin personas.
4. Verify attendance privacy and payslip IDOR protection with direct URL/API attempts, not navigation visibility alone.
5. Verify Microsoft Entra, Graph mail/calendar, private object storage, malware scanning, backups, alert delivery, and Secret Manager values in the target environment.
6. Validate Qatar payroll/WPS output against the current bank-approved SIF specification and a golden sample before enabling production export.
7. Take an application-consistent backup, deploy through the existing `medtech-hr-erp` Compose project, and pass `/healthz` plus `/api/v1/health` checks.
8. Record approvers, deployed commit, migration version, rollback point, and acceptance evidence.

## Non-negotiable external sign-offs

Production status cannot be inferred from source alone. Business workflow owners must approve the role matrix and approval routing; Finance must approve payroll/WPS calculations; HR must approve certificate and employee-data handling; IT/Security must approve identity, secrets, backups, monitoring, and disaster recovery.

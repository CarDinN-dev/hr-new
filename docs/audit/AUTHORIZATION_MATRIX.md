# HR ERP Authorization Matrix

**Revision:** `2e833d0aeff3797341e609c6993aa2b16b284450`

**Status:** Preliminary static matrix. Runtime four-role denial tests were not completed.

## Enforcement model

`JwtAuthGuard`, `CsrfGuard`, and `RolesGuard` are global guards (`backend/src/app.module.ts:29-33`). `JwtStrategy` reloads the current database user, rejects inactive/deleted accounts, checks `sessionVersion`, and supplies current role/permissions/employee link (`backend/src/modules/auth/strategies/jwt.strategy.ts:20-39`). `RolesGuard` lets `SUPER_ADMIN` bypass role/permission checks, otherwise requires all declared roles/permissions (`backend/src/modules/auth/guards/roles.guard.ts:11-47`).

No controller-level `@Permissions(...)` use was found. Effective policy is therefore primarily role decorators plus service-level object predicates. Endpoints without `@Roles` are available to every authenticated role and depend entirely on service scoping.

Legend: **SA** = `SUPER_ADMIN`, **HR** = `HR_ADMIN`, **MGR** = `MANAGER`, **EMP** = `EMPLOYEE`.

## Endpoint and resource matrix

| Endpoint / action | Controller role gate | Expected resource scope | Observed enforcement | Status |
| --- | --- | --- | --- | --- |
| `GET /health` | Public | Health only; no sensitive details | Public health controller | Acceptable |
| `POST /auth/login` | Public | Credential verification only | Generic error text, bcrypt, account/IP counters; proxy/timing concerns remain (`auth.controller.ts:24-29`, `auth.service.ts:43-110`) | Conditional |
| `POST /auth/register` | SA, HR | Create EMP account only | Role decorator present; register DTO/service must remain employee-only (`auth.controller.ts:17-22`) | Acceptable statically |
| `GET /auth/me` | Any authenticated | Current principal only | Returns guard-populated request user (`auth.controller.ts:31-35`) | Acceptable |
| `POST /auth/logout` | Any authenticated | Current session/account | Increments current user's session version (`auth.controller.ts:37-43`) | Acceptable |
| `GET/PUT /console-state` | SA, HR | Organization-wide console state | Class-level SA/HR gate and optimistic state handling (`console-state.controller.ts:11-25`) | Acceptable statically |
| Console-state backup/status/rollback | SA, HR | Organization-wide backup set | Class-level SA/HR gate (`console-state.controller.ts:27-40`) | Acceptable statically; restore not runtime-tested |
| Employee create/update/delete | SA, HR | Organization-wide employee administration | Route roles at `employees.controller.ts:18-20,39-47` | Acceptable statically |
| Employee list/detail | Any authenticated | SA/HR all; MGR direct reports; EMP self | Service predicates exist, but ordinary roles can request `includeDeleted` (`employees.controller.ts:24-36`, `employees.service.ts:45-53`) | **Gap FS-011** |
| Department and job-position writes | SA, HR | Organization-wide reference data | Route roles present (`departments.controller.ts:16-40`, `job-positions.controller.ts:16-40`) | Acceptable statically |
| Department and job-position reads | Any authenticated | Active reference data | No role gate; shared `includeDeleted` can expose deleted rows (`departments.service.ts:24`, `job-positions.service.ts:22`) | **Gap FS-011** |
| Employment-contract writes | SA, HR | Organization-wide contracts | Route roles present (`employment-contracts.controller.ts:18-42`) | Acceptable statically |
| Employment-contract list/detail | Any authenticated | SA/HR all; MGR reports; EMP own | Service scoping exists; deleted-row flag is not privileged (`employment-contracts.controller.ts:24-31`, `employment-contracts.service.ts:26-32`) | **Gap FS-011** |
| `POST /attendance` and attendance update/delete | SA, HR | Organization-wide correction/admin | Route roles present (`attendance.controller.ts:19-21,51-59`) | Acceptable statically |
| Attendance check-in/check-out | Any authenticated | Current linked employee only | Controller passes current principal; service ownership path exists (`attendance.controller.ts:25-33`) | Acceptable statically |
| Attendance list/detail | Any authenticated | SA/HR all; MGR reports; EMP self | Service subject filters exist; `includeDeleted` remains caller-controlled (`attendance.controller.ts:41-48`, `attendance.service.ts:38-40`) | **Gap FS-011** |
| Attendance summary | SA, HR, MGR | HR all; MGR reports | Role/subject scope exists, but report always includes deleted rows (`attendance.controller.ts:35-38`, `attendance.service.ts:142-174`) | **Gap FS-012** |
| Leave-type writes | SA, HR | Organization-wide policy | Route roles present (`leave-types.controller.ts:16-40`) | Acceptable statically |
| Leave-type reads | Any authenticated | Active policy data | Deleted-row flag is not privileged (`leave.service.ts:40`) | **Gap FS-011** |
| Leave-balance create/update/delete | SA, HR | Organization-wide balances | Route roles present (`leave-balances.controller.ts:18-42`) | Acceptable statically |
| Leave-balance list/detail | Any authenticated | SA/HR all; MGR reports; EMP own | Subject scope exists; deleted-row flag is not privileged (`leave-balances.controller.ts:24-31`, `leave.service.ts:70-76`) | **Gap FS-011** |
| Leave request create/update/cancel | Any authenticated | Employee self; HR policy overrides only where explicit | Service checks caller/object, but duration and concurrent state transitions are not authoritative/atomic (`leave-requests.controller.ts:19-21,43-56`, `leave.service.ts:117-307`) | **Gaps FS-003 to FS-007** |
| Leave request list/detail/history | Any authenticated | SA/HR all; MGR reports; EMP self | Subject predicates exist; `includeDeleted` can expose deleted requests (`leave-requests.controller.ts:24-40`, `leave.service.ts:148-150`) | **Gap FS-011** |
| Leave decision | SA, HR, MGR | SA/HR allowed; MGR only direct reports | Role gate and manager scope present; transition is race-prone (`leave-requests.controller.ts:48-51`, `leave.service.ts:241-277`) | **Gap FS-006** |
| Salary-record create/update/delete | SA, HR | Organization-wide salary administration | Route roles present (`salary-records.controller.ts:18-42`) | Acceptable statically |
| Salary-record list/detail | Any authenticated | SA/HR all; EMP own; MGR only if policy permits | Service object scope exists; deleted-row flag is not privileged (`salary-records.controller.ts:24-31`, `payroll.service.ts:45-48`) | **Gap FS-011** |
| Payroll create/generate/update/approve/delete | SA, HR | Organization-wide payroll | Route roles present (`payroll.controller.ts:19-27,53-67`) | Role gate present; separation-of-duties policy not established |
| Payroll list/detail/payslip | Any authenticated | SA/HR all; EMP own; MGR only if policy permits | Service object scope exists; deleted-row flag can expose deleted payroll (`payroll.controller.ts:31-50`, `payroll.service.ts:91-94`) | **Gap FS-011** |
| Performance-review create/update | SA, HR, MGR | HR as policy; MGR only reviews they own for direct reports | Route role and direct-report checks exist; update does not require existing reviewer ownership and rewrites reviewer (`performance-reviews.controller.ts:18-36`, `performance-reviews.service.ts:63-88`) | **Gap FS-010** |
| Performance-review list/detail | Any authenticated | HR all; MGR appropriate reports/reviews; EMP own | Service scope exists; deleted-row flag is not privileged (`performance-reviews.controller.ts:24-31`, `performance-reviews.service.ts:35-41`) | **Gap FS-011** |
| Performance-review delete | SA, HR | Organization-wide admin | Route roles present (`performance-reviews.controller.ts:40-43`) | Acceptable statically |
| Document create/list/detail/update/delete | Any authenticated | Visibility + employee/uploader/manager/HR object scope | Service predicates exist; deleted metadata can be exposed through shared flag (`documents.controller.ts:16-38`, `documents.service.ts:43-49`) | **Gap FS-011** |
| Announcement create | SA, HR, MGR | SA/HR policy; MGR own department and allowed audiences only | Role gate present; service accepts manager-selected department/audience (`announcements.controller.ts:18-21`, `announcements.service.ts:18-29`) | **Gap FS-008** |
| Announcement update | SA, HR, MGR | HR policy; MGR only own rows without unauthorized retargeting | Creator ownership exists, but targeting fields remain unrestricted (`announcements.controller.ts:34-37`, `announcements.service.ts:61-67`) | **Gap FS-009** |
| Announcement list/detail | Any authenticated | Active role audience and caller department | Role/time filter exists; department membership is absent; deleted-row flag is available (`announcements.controller.ts:24-31`, `announcements.service.ts:31-47,75-87`) | **Gaps FS-008, FS-011** |
| Announcement delete | SA, HR | Organization-wide moderation | Route roles present (`announcements.controller.ts:40-43`) | Acceptable statically |

## Authorization root causes

1. **Role checks are used where object-policy checks are required.** Announcement targeting and performance-review ownership depend on properties of the existing/caller-linked object, not only the caller's role.
2. **A privileged query option is defined in a shared public DTO.** `includeDeleted` is converted into a data-layer predicate without an authorization decision at `backend/src/common/dto/pagination-query.dto.ts:34-40` and `backend/src/common/utils/crud.util.ts:30-43`.
3. **List/detail/report paths do not always share the same scope builder.** Attendance summary bypasses the list's soft-delete arguments; announcement list/detail share an incomplete department predicate.
4. **Permissions are supported but not used by controllers.** This is not itself a vulnerability, but it means documentation and tests should not claim fine-grained permission enforcement that route metadata does not declare.

## Required denial tests

The remediation suite must explicitly test: EMP access to another employee's employee, document, attendance, leave, salary, payroll, contract, and review IDs; MGR access outside direct reports; MGR announcement create/update targeting outside their department; MGR update of an HR-authored review; every non-HR `includeDeleted=true` list; deleted-row exclusion in attendance summary; HR/SA positive controls; inactive/deleted account rejection; stale `sessionVersion` rejection; and CSRF rejection for every unsafe authenticated method.

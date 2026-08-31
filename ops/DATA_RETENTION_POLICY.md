# HR ERP Data Retention Policy

Status: **Provisional — HR and legal approval required before automated category deletion.**

Until the schedule below is approved, document versioning and 30-day soft deletion remain enabled and no category-based lifecycle rule may permanently delete HR records.

| Category | Provisional retention period |
|---|---|
| Core employee and employment records | Seven years after separation |
| Payroll, compensation, loans, and exports | Ten years after the financial period closes |
| Attendance, leave, trips, and expenses | Seven years after closure |
| Performance, training, credentials, and education | Seven years after separation |
| Recruitment for unsuccessful candidates | Two years after the hiring decision |
| Service certificates and employee-request outputs | Seven years after issue or separation, whichever is later |
| Audit events, access certifications, and security exports | Seven years from event or export |
| Security/admin cloud logs | 400 days in the locked `_Required` bucket |
| Routine application and container logs | 90 days, subject to Security/Legal and cost approval |
| Backups | Hourly 8 days, daily 35 days, weekly 190 days, monthly 7 years |
| PII-free release rollback bundles | 35 days |
| Security configuration baselines | 400 days |
| Quarantined or rejected uploads | 30 days after final rejection unless needed for investigation |

## Required controls

- A legal hold overrides every scheduled deletion.
- Soft deletion is not final disposal; final deletion must be audited.
- Existing documents without a confirmed category remain retained until HR classifies them.
- Release bundles must not contain database dumps, HR documents, employee screenshots, secrets, private keys, or unredacted configuration. Existing `releases/` objects that contain those items are backups, not release artifacts, and require Data Protection review before disposal.
- Every GCS prefix must have a named owner and one category from the table; `releases/` and `security-baselines/` may receive lifecycle rules only after this policy is approved.
- GCS lifecycle configuration must match the approved policy; broad age-only deletion must not affect mixed HR records.
- HR and legal review the schedule annually and after applicable regulatory changes.

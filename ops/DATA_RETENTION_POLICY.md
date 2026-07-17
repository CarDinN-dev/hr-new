# HR ERP Data Retention Policy

Status: **Provisional — HR and legal approval required before automated category deletion**

The application must retain records according to their business category, not merely their filename or MIME type. Until the schedule below is approved, document versioning and 30-day soft deletion remain enabled and no category-based lifecycle rule may permanently delete HR records.

| Category | Provisional retention trigger and period | Disposal control |
|---|---|---|
| Core employee and employment records | Seven years after separation | Approved deletion job plus immutable audit event |
| Payroll, compensation, loans, and payroll exports | Ten years after the financial period closes | Finance and HR approval; preserve legal holds |
| Attendance, leave, trips, and expenses | Seven years after the record closes | Category-aware deletion; preserve active disputes |
| Performance, training, credentials, and education | Seven years after separation | HR approval; preserve active cases |
| Recruitment for unsuccessful candidates | Two years after the hiring decision | Remove candidate documents and identifiers together |
| Service certificates and employee-request outputs | Seven years after issue or separation, whichever is later | Retain the issued version and audit lineage |
| Audit events, access certifications, and security exports | Seven years from event/export | Never rewrite; verify audit-chain integrity before archival |
| Backups | Hourly 8 days, daily 35 days, weekly 190 days, monthly 7 years | Enforced bucket lifecycle plus retention/soft-delete protection |
| Quarantined or rejected uploads | 30 days after final rejection unless needed for investigation | Security-approved deletion; never permit download |

## Required controls

- A legal hold overrides every scheduled deletion.
- Soft deletion is not final disposal. Final deletion must be audited with category, record identifier, actor/job identity, policy version, and reason.
- Existing documents without a confirmed category remain retained until HR classifies them.
- Malware status does not change the business retention period; rejected content remains inaccessible and follows the quarantine rule.
- GCS lifecycle configuration must match the approved database policy. A broad age-only lifecycle rule must not delete mixed-category HR documents.
- HR and legal must review the schedule annually and after any applicable regulatory change.


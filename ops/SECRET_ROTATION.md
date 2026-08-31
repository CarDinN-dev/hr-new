# Production secret rotation

Secret values stay in Secret Manager; `.env` contains only identifiers and ISO-8601 rotation/expiry timestamps used by monitoring.

| Secret | Owner | Maximum age | Safe rollout |
| --- | --- | --- | --- |
| PostgreSQL superuser | DBA | 180 days | Rotate after app/migrator credentials; verify backup and local admin access. |
| `hr_erp_app` password | DBA / Platform | 90 days | Create a new password, update Secret Manager, recreate API, verify `current_user`, then revoke the old session pool. |
| `hr_erp_migrator` password | DBA / Platform | 90 days | Update outside a migration window; prove app runtime still cannot use the role. |
| JWT signing secret | Platform | 90 days | Announce forced sign-out, update the secret, deploy, revoke existing sessions, and retain the prior version disabled for rollback only. |
| Audit HMAC | Security / Platform | 365 days | Use the key-ID overlap procedure below so historical events remain verifiable. |
| Microsoft SSO / provisioning credentials | IAM | Before credential expiry | Follow `MICROSOFT_CREDENTIAL_ROTATION.md`; overlap credentials and canary before revocation. |
| Bootstrap administrator password | Security | One use | Remove it from `.env` and Secret Manager immediately after the guarded seed succeeds. |

## Audit HMAC overlap

1. Keep the current key and its ID. Existing unversioned events use ID `legacy`.
2. Generate a new 256-bit-or-stronger key and a unique ID such as `2026-09`.
3. Put the new key in `hr-erp-audit-hmac-key`. Put a JSON map of still-required verification keys in `hr-erp-audit-hmac-previous-keys`, for example an object with the old ID as its key. Never place the JSON value in source control.
4. Set `AUDIT_HMAC_KEY_ID` and `AUDIT_HMAC_KEY_ROTATED_AT`, deploy, create a synthetic audit event, and verify the full chain.
5. Roll back by restoring the prior active key and ID. Remove a verification key only after every event signed by it has expired under the approved audit-retention policy and no legal hold requires it.

## Required evidence

For every rotation, record owner, old/new key IDs or Secret Manager version numbers (never values), canary result, rollback result, session impact, next due date, and alert acknowledgement. Alert when an age metric is `-1` or exceeds the table above, when a Microsoft credential reaches 90/60/30/7 days, and on anomalous Secret Manager access.

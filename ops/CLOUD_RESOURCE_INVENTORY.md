# HR ERP Cloud Resource Inventory

Verified: 2026-07-17  
Google Cloud project: `hr-erp-502412`

## Compute and network

| Resource | Current configuration |
|---|---|
| VM | `hrerp1`, `me-central1-b`, `e2-standard-2`, deletion protection enabled |
| External IP | `34.18.109.32` (administration remains IAP-only) |
| Shielded VM | Secure Boot, vTPM, and integrity monitoring enabled |
| Runtime identity | `hr-erp-runtime@hr-erp-502412.iam.gserviceaccount.com` |
| SSH | `allow-iap-ssh`, source `35.235.240.0/20`, target tag `iap-ssh`, firewall logging enabled |
| Disabled ingress | Default public SSH, RDP, HTTPS, ICMP, and internal rules |
| Application ports | Frontend, API, and PostgreSQL bound to loopback only |

The application runs only in the existing `/opt/medtech-hr-erp` Compose project. Its services are `postgres`, `api`, `hr-erp`, and `clamav`. The current public endpoint is the temporary Quick Tunnel `https://resulted-supporting-alone-limitation.trycloudflare.com/`; it remains an availability single point and must not be restarted outside an approved maintenance window.

## Identities and secrets

| Identity/resource | Purpose |
|---|---|
| `hr-erp-runtime@…` | VM and application runtime; reads only the application secrets it requires |
| `hr-erp-backup@…` | Dedicated backup object writer; impersonated by the runtime for scheduled backups |
| Default Compute service account | Retained but no longer holds project Editor |
| Secret Manager | PostgreSQL password, JWT secret, audit HMAC key, Microsoft client secret, and Microsoft provisioning client secret |

Secret values never belong in this inventory, source control, ordinary `.env` files, logs, or deployment output.

## Storage and recovery

| Bucket | Controls |
|---|---|
| `gs://hr-erp-502412-documents` | Regional, uniform bucket-level access, public-access prevention, versioning, 30-day soft deletion |
| `gs://hr-erp-502412-backups` | Regional, uniform bucket-level access, public-access prevention, seven-day retention lock, 30-day soft deletion, hourly/daily/weekly/monthly lifecycle |

The hourly backup timer creates a custom-format PostgreSQL dump and checksum manifest. Restore drills must use isolated containers, networks, and volumes and must never target the production database.

## Operations and monitoring

- Google Ops Agent collects host and Docker logs.
- Systemd timers run the backup hourly and health monitor every five minutes.
- The public HTTPS uptime check runs every 60 seconds against `/healthz`.
- Alert policies cover endpoint availability, API errors, authentication failures, component health, CPU, memory, disk, backup freshness, scanner failures, and monitor silence.
- The `HR ERP operations email` channel exists and is enabled, but recipient verification and test delivery remain open production gates.

## External identity

The Microsoft Entra application remains configured for the former Quick Tunnel callback. `MICROSOFT_LOGIN_ENABLED=false` is therefore the fail-closed production setting until an Entra administrator updates and verifies the callback for the current endpoint.


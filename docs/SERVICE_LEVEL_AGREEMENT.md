# MedTech HR ERP — Service-Level Agreement

**Status:** Current operational statement; not a contractual service-level commitment
**Effective date:** 27 July 2026
**Applies to:** The MedTech HR ERP deployment described in this repository

## 1. Purpose, status, and terminology

This document records the service characteristics that are implemented or documented for the current MedTech HR ERP deployment. It deliberately does not invent availability, support, recovery, performance, compliance, or financial commitments that are not defined in the repository.

There is no executed customer contract, support desk process, on-call rota, response-time target, resolution-time target, uptime objective, service-credit scheme, recovery-time objective (RTO), or recovery-point objective (RPO) in the current repository. None is provided by this document.

In this statement, **implemented** means present in the tracked configuration or application; **monitored** means a configured technical check exists; and **committed** means a measurable promise accepted by the service owner. The current operation has implemented controls and monitoring, but no committed customer-facing targets.

## 2. Service covered

The deployment comprises the following components:

| Component | Current implementation |
| --- | --- |
| Web application | React application served by Nginx. |
| Application API | NestJS API exposed to the web application at `/api/v1`. |
| Primary data store | PostgreSQL database. |
| Document scanning | ClamAV container used by the API when document scanning is enabled; production configuration requires scanning to be enabled. |
| Document storage | Google Cloud Storage when `GCS_DOCUMENTS_BUCKET` is configured. The filesystem adapter is restricted to tests. |
| Public edge | Host Nginx listens on public ports 80 and 443 and proxies HTTPS traffic to the loopback-only web container on port 8080. The configured Cloudflare Quick Tunnel service is inactive and is not the current public path. |
| Production host | One running Google Cloud VM (`hrerp1`) in `me-central1-b`, running the `medtech-hr-erp` Docker Compose project. The verified instance type is `e2-standard-2` (2 vCPU, 8 GiB memory) with an 80 GiB balanced persistent boot disk. |

The configuration does not define a second application site, database replica, automatic regional failover, or active-active deployment. This service statement therefore does not claim high availability or disaster recovery beyond the documented backup and restoration mechanisms.

## 3. Availability and measurement

### 3.1 What is monitored

The deployment includes these health mechanisms:

| Check | What it verifies | Configured frequency or limit |
| --- | --- | --- |
| `GET /healthz` | Nginx web endpoint returns `200 ok`. | Used during deployment verification. |
| `GET /api/v1/health` | API can complete `SELECT 1` against PostgreSQL. | Docker health check: every 10 seconds, 5-second timeout, 5 retries after a 20-second start period. The host monitor uses a 5-second request timeout. |
| PostgreSQL health check | PostgreSQL accepts `pg_isready` for the application database. | Docker health check: every 10 seconds, 5-second timeout, 5 retries. |
| ClamAV health check | The scanner responds to `clamdcheck.sh`. | Docker health check: every 10 seconds, 5-second timeout, 12 retries, with a 6-minute start period. |
| Host health publisher | Publishes API, database, tunnel, container, backup-age, and failed-document-scan metrics to Google Cloud Monitoring. | Systemd timer runs every five minutes with up to 30 seconds of timer accuracy variation. |
| Container logging | The active Google Cloud Ops Agent reads Docker JSON logs and sends them to the project default Cloud Logging bucket. | `_Default` log bucket retention: 30 days. The required audit bucket has 400-day locked retention. Log ingestion volume is not yet reported as an operational KPI. |

The Cloud Resource Inventory records Google Cloud Monitoring checks and alerts for component, resource, backup, scanner, and authentication failures. This repository does not contain the alert policies, notification recipients, escalation path, acknowledgement target, or repair target.

The current public edge is a single host Nginx instance. It does not provide redundancy, load balancing, automatic failover, or a supplier availability commitment. The configured Cloudflare Quick Tunnel is inactive; if it is enabled later, Cloudflare documents Quick Tunnels as a free testing/development facility without an SLA and with a 200 in-flight-request limit.

### 3.2 No availability commitment

No uptime percentage, monthly availability target, downtime exclusion policy, measurement formula, reporting period, or uptime report is defined. Health checks indicate component reachability at the time they run; they do not establish a service-level availability guarantee.

The service may be unavailable because of application deployment, host Nginx failure, host failure, database failure, Google Cloud service failure, scheduled system work, security action, network failure, or other dependency failure. The current materials do not classify these events as included or excluded downtime.

## 4. Support and incident handling

No support contact channel, support-hours schedule, severity matrix, incident owner, escalation procedure, acknowledgement target, update cadence, resolution target, or post-incident review process is currently defined.

The application returns a request ID in the `X-Request-ID` response header. API errors have a structured response containing a status code, message, path, and timestamp. These are diagnostic capabilities, not a support commitment.

## 5. Maintenance and deployment

Production changes are deployed only through the existing `medtech-hr-erp` Docker Compose project on the documented production host. The deployment script:

1. checks the existing database health, backup timer, free disk space, available memory, configuration, and age of the last successful backup;
2. starts an application-consistent backup;
3. rebuilds the API and web images, applies Prisma migrations, and starts the affected application containers;
4. waits for API, web, and scanner health checks; and
5. checks both `/healthz` and `/api/v1/health`.

If a deployment command fails after the previous API and web images have been tagged, the script restores those application image tags and restarts the API and web containers. It does not provide a database migration rollback.

No maintenance window, advance-notice period, maximum maintenance duration, or maximum deployment interruption is defined. The configured Cloudflare Quick Tunnel is inactive and must not be treated as a required deployment dependency unless it is explicitly enabled and verified.

## 6. Data protection, backup, and recovery

### 6.1 Primary data and documents

HR application data is stored in PostgreSQL. Uploaded documents are stored in the configured Google Cloud Storage bucket, not in the API container. Document uploads are limited to one file of up to 10 MiB and to the configured PDF, JPEG, PNG, WebP, DOCX, and XLSX MIME types. In production, document scanning is required; documents are scanned through ClamAV and scan failures are recorded for monitoring.

### 6.2 Database backups

The configured systemd timer runs a database backup hourly, with a randomized delay of up to five minutes. The backup script creates a PostgreSQL custom-format dump and a JSON manifest containing the dump checksum and size, then uploads them to the `hr-erp-502412-backups` bucket. At midnight UTC, it also writes daily copies; on Sunday midnight UTC, weekly copies; and on the first day of the month at midnight UTC, monthly copies.

The backup manifest records that documents are stored separately in Google Cloud Storage. The database backup does not itself contain document objects. A complete recovery involving documents depends on the relevant document bucket and its retained objects being available.

The production script contains an isolated restore-drill command. It validates the manifest checksum, restores a dump to a temporary PostgreSQL container, applies migrations, starts a temporary API, checks its health endpoint, and runs the financial regression script. The repository does not provide evidence that a restore drill has been run on a defined schedule or that any restoration time has been measured.

### 6.3 No recovery commitment

Hourly backups do not create an RPO guarantee, and the restore-drill command does not create an RTO guarantee. No maximum data-loss interval, maximum restoration time, restoration priority, restoration owner, or customer notification process is defined.

The data-retention policy remains provisional pending HR and legal approval. The currently verified backup-bucket lifecycle configuration deletes objects under the hourly, daily, weekly, and monthly prefixes after 8, 35, 190, and 2,555 days respectively. The same bucket has a seven-day object-retention policy and a 30-day soft-delete policy; the document bucket has versioning and a 30-day soft-delete policy. Object lifecycle deletion, retention locking, versioning, and soft deletion can all affect the time for which bytes remain recoverable and billable. These configurations are operational facts, not an approved HR retention commitment.

Until category retention is approved, the policy states that category-based permanent deletion must not be automated. It also states that document versioning and 30-day soft deletion remain enabled. Legal holds override scheduled deletion under that provisional policy.

## 7. Security controls present in the application

The following controls are implemented or configured:

| Area | Current control |
| --- | --- |
| Network exposure | Compose ports for the API and PostgreSQL are bound to loopback; host Nginx terminates public HTTP/HTTPS traffic and proxies to the loopback-only web service. |
| Transport and browser protections | Nginx configures TLS 1.2 and TLS 1.3 and sends HSTS, Content-Security-Policy, frame-denial, content-type, referrer, and permissions-policy headers. |
| Authentication | Local authentication uses bcrypt password comparison, JWT-backed sessions, and database-backed session records. Microsoft sign-in is also implemented when its environment configuration is supplied. |
| Authorization | The API uses global JWT, CSRF, and permission guards. |
| Input handling | Global validation rejects non-whitelisted DTO properties. JSON and URL-encoded API bodies are limited to 1 MiB. |
| Auditability | The application records audit events for relevant operations and authorization denials; requests receive an ID. |
| Data access | Sensitive document and payslip download responses are marked `private, no-store`. |
| Runtime hardening | The API drops Linux capabilities and enables `no-new-privileges`; application containers use restart policies and health checks. |
| Secrets | The production deployment script reads designated secrets from Google Secret Manager into a temporary, root-readable runtime environment file. |

These controls are not a claim of certification, legal compliance, security guarantee, penetration-test result, or immunity from security incidents. No compliance certification, audit scope, remediation status, vulnerability response time, breach notification period, or security support commitment is defined in this repository.

## 8. Functional and performance boundaries

The application provides HR workflows, including employee records, attendance, leave, payroll, loans, documents, approvals, service requests, performance reviews, and related administrative functions.

The repository defines technical limits such as API request-body limits and document upload limits, but it does not define transaction-throughput, concurrent-user, report-generation, page-load, API-response, payroll-processing, storage-capacity, or browser-support targets. It therefore makes no performance or capacity service-level commitment.

## 9. Customer-facing commitments not currently defined

The following are not defined for this application and must not be inferred from the presence of monitoring, backups, security controls, or deployment automation:

- guaranteed service hours or 24/7 operation;
- availability percentage or uptime reporting;
- incident response or repair times;
- support contact details or escalation;
- planned-maintenance notice or maintenance-duration limits;
- RPO, RTO, restore priority, or restore completion time;
- data-retention guarantee beyond an approved and verified lifecycle configuration;
- service credits, refunds, penalties, or other remedies;
- compliance, data-residency, encryption-at-rest, or certification commitment; and
- third-party service commitments for Cloudflare, Google Cloud, Google Cloud Storage, Google Secret Manager, or Microsoft identity services.

## 10. Dependencies and exclusions

The service depends on Google Cloud Compute Engine, Persistent Disk, Cloud Storage, Secret Manager, Cloud Monitoring, host Nginx, Docker image registries, and—where enabled—Microsoft identity services. A failure or change in any dependency can affect the service. Cloudflare is not a current traffic-path dependency because its configured Quick Tunnel service is inactive.

This statement excludes end-user devices, local networks, internet service providers, customer-side data entry, third-party identity availability, data owned outside the two configured Cloud Storage buckets, and any service not explicitly listed in section 2. It does not transfer any third-party supplier commitment to the application operator.

## 11. Source basis and review

This statement is based on the repository configuration and operational documentation, plus a read-only Google Cloud inventory check, as of 27 July 2026. Primary sources are `docker-compose.yml`, `docker-compose.production.yml`, `nginx.conf`, `ops/backup.sh`, `ops/health-monitor.sh`, `ops/production.sh`, the systemd unit files, `ops/CLOUD_RESOURCE_INVENTORY.md`, `ops/DATA_RETENTION_POLICY.md`, and the API source.

It should be reviewed whenever the hosting topology, tunnel, backup retention, monitoring/alert policies, support process, security controls, or contractual terms change. A future contractual SLA should be approved by the service owner and, where applicable, HR, legal, security, and the relevant cloud-service owners before it states measurable commitments.

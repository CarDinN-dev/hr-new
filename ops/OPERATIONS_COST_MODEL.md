# MedTech HR ERP — Current Operations Cost Model

**Status:** Operational cost model, not an invoice, quote, or contractual price
**Prepared:** 27 July 2026
**Currency:** USD, with SAR shown at the fixed planning conversion of **1 USD = 3.75 SAR**
**Billing basis:** On-demand public list prices effective 27 July 2026; excludes tax and credits

## 1. What this model measures

This document separates the known fixed infrastructure price from consumption-based charges. It is based on a read-only inventory of the live Google Cloud project and the active operational configuration. The project has billing enabled, but no Cloud Billing export or invoice data is stored in this repository; this model must not be presented as the amount billed by Google Cloud.

The baseline uses a 730-hour month. Actual monthly billing uses the provider's measured usage, can differ in the number of hours, and may include credits, taxes, foreign-currency conversion, support plans, or services not visible in the deployment repository.

## 2. Verified current footprint

| Resource | Verified configuration | Cost treatment |
| --- | --- | --- |
| Compute host | One running `e2-standard-2` VM in Doha (`me-central1-b`): 2 vCPU and 8 GiB memory. | Fixed while the VM is running. |
| Boot disk | One 80 GiB `pd-balanced` persistent disk in Doha. | Fixed while the disk exists, including when the VM is stopped. |
| Public IPv4 | One ephemeral Premium-tier external IPv4 attached to the running VM. | Current public SKU rate is $0 while attached to a standard VM. |
| Application runtime | React/Nginx, NestJS API, PostgreSQL, and ClamAV run inside that VM's existing Docker Compose project. | No separate managed-service charge. Their CPU, memory, and local storage are included in the VM and disk lines. |
| Document storage | Regional Standard GCS bucket in `ME-CENTRAL1`; current stored volume is 899.28 KiB. | Usage-based. |
| Backup storage | Regional Standard GCS bucket in `ME-CENTRAL1`; current stored volume is 250.75 MiB. | Usage- and operation-based. |
| Monitoring | Cloud Monitoring health publisher and public uptime checks. | Usage-based after free allocations. |
| Container logging | The active Google Cloud Ops Agent ingests Docker JSON logs into the project default Cloud Logging bucket. | First 50 GiB/project/month of ingestion is free; default retention is 30 days. |
| Secrets | Five production secrets are retrieved only during protected deployment or backup setup. | Expected to remain within included usage at the current operating pattern. |
| Public edge | Host Nginx listens on public ports 80 and 443 and proxies to the loopback-only application container. The configured Cloudflare Quick Tunnel service is inactive. | Included in the VM and attached-IP lines; no current Cloudflare tunnel charge. |

No separate Cloud SQL, managed load balancer, CDN plan, Cloud Run service, NAT gateway, VPN, managed Kubernetes cluster, active Cloudflare tunnel, paid Cloudflare plan, or Google Cloud support plan is evidenced by the current deployment materials.

## 3. Fixed monthly baseline

| Line item | Rate | Calculation (730 h/month) | USD/month | SAR/month |
| --- | ---: | ---: | ---: | ---: |
| E2 vCPU | $0.02650108 per vCPU-hour | 2 × 730 × $0.02650108 | $38.69 | SAR 145.09 |
| E2 memory | $0.003552089 per GiB-hour | 8 × 730 × $0.003552089 | $20.74 | SAR 77.79 |
| 80 GiB balanced persistent disk | $0.1215 per GiB-month | 80 × $0.1215 | $9.72 | SAR 36.45 |
| Attached external IPv4 | $0 per hour | Current SKU price × 730 | $0.00 | SAR 0.00 |
| **Fixed infrastructure subtotal** |  |  | **$69.16** | **SAR 259.35** |

The VM is the primary cost driver: **$59.44/month (SAR 222.88)**, or about 86% of the fixed baseline. The baseline is approximately **$2.27/day (SAR 8.52/day)** and **$829.87/year (SAR 3,112.01/year)** if the footprint and list prices do not change.

## 4. Current storage charge

Standard regional storage in Doha is $0.023 per GiB-month. The currently observed bucket footprint is 251.63 MiB (about 0.2457 GiB):

| Storage line | Current volume | Formula | USD/month | SAR/month |
| --- | ---: | ---: | ---: | ---: |
| Documents bucket | 899.28 KiB | 0.000858 GiB × $0.023 | $0.00002 | SAR 0.00007 |
| Backups bucket | 250.75 MiB | 0.2449 GiB × $0.023 | $0.00563 | SAR 0.0211 |
| **Current stored-data subtotal** | **251.63 MiB** |  | **$0.00565** | **SAR 0.0212** |

The current run-rate before unknown variable costs is therefore **$69.17/month (SAR 259.37)**. Rounding to a practical budget figure, reserve **$70/month (SAR 263/month)** before data transfer, operations, monitoring overages, tax, and any unrecorded supplier services.

## 5. Variable and unpriced charges

| Cost area | Current configuration | Cost model / control |
| --- | --- | --- |
| Internet egress | The public edge and document downloads can transfer data to users. No monthly egress volume is recorded. | Add provider-measured GiB × applicable networking rate. This is the largest unknown variable charge. |
| GCS operations | The backup job writes a dump and manifest hourly, plus duplicate daily/weekly/monthly objects. | Standard single-region Class A operations are billed per 1,000 operations; at the current schedule this is only a few thousand writes per month, but downloads, listings, restores, and document traffic add usage. |
| Backup growth | Full database dumps are kept at four lifecycle tiers. The backup bucket has 30-day soft delete and versioning. | Storage grows with the compressed dump size and deleted-object retention. Budget with the formula below, not solely with today's 250.75 MiB measurement. |
| Cloud Monitoring | The host publisher sends six custom metrics every five minutes; public uptime checks and alert policies are configured outside the repository. | Use Monitoring usage reports. The first 150 MiB/month of chargeable metric ingestion is free; above that, billed ingestion applies. Uptime checks have a one-million-execution monthly free allocation. Alert-policy metric references become billable from September 2026. |
| Cloud Logging | The active Ops Agent reads `/var/lib/docker/containers/*/*.log` and routes it to the default bucket, which retains logs for 30 days. No ingestion-volume baseline is recorded yet. | First 50 GiB/project/month of log ingestion is free; add $0.50/GiB above it and $0.01/GiB-month for retention beyond 30 days. |
| Secret Manager | Five deployment secrets are accessed at deployment time, not by each application request. | Six active versions and 10,000 accesses per billing account/month are free. Above that, budget $0.06 per active version-month and $0.03 per 10,000 accesses. |
| Microsoft identity | Code and configuration support Microsoft sign-in/provisioning, but no licence or tenant cost is recorded here. | Obtain the organisation's Microsoft invoice; do not assume $0. |
| Cloudflare | The Quick Tunnel unit remains installed but inactive; current public traffic is handled by host Nginx. | $0 current cost. Re-enable or replace it only with an explicit design and a new price/SLA review. |
| Labour and support | No support rota or managed-operations provider is configured. | Excluded. Add named staff/vendor hours and after-hours coverage only when a support model is approved. |

## 6. Backup-growth planning formula

The backup script creates one full custom-format database dump every hour. At steady state, ignoring compression changes, its nominal live retention creates approximately 192 hourly, 35 daily, 28 weekly, and 84 monthly copies: **339 dump copies**. The 30-day soft-delete policy can retain approximately a further 720 hourly, 30 daily, 5 weekly, and 1 monthly deleted copy: **756 additional copies**. That is a planning ceiling of approximately **1,095 dump-equivalents** before accounting for object version history.

For each additional **1 GiB** of average compressed dump size retained at that ceiling:

`1,095 GiB × $0.023/GiB-month = about $25.19/month (SAR 94.46/month)`

This is a planning estimate, not a promise of storage volume. The actual amount changes with database growth, lifecycle execution timing, soft-deleted objects, version history, and retained manifests. Monthly review should use the bucket's measured byte count and object-version status.

## 7. Cost controls and review

1. Set a Cloud Billing budget at **$100/month (SAR 375/month)** initially, with alerts at 50%, 80%, and 100%. This preserves roughly $31/month headroom for current unmeasured variable use.
2. Enable a daily cost export or review Google Cloud Billing reports by SKU. Replace the estimate in section 3 with invoice-backed actuals after one complete month.
3. Review GCS bytes, object versions, soft-deleted bytes, and egress monthly; do not alter HR-record retention or backup lifecycle rules without HR/legal approval and a restore test.
4. Reprice after a VM resize, disk change, Cloudflare replacement, regional move, managed-service adoption, or supplier price change.

## 8. Price sources and assumptions

The public Google Cloud SKU catalog was queried on 27 July 2026 for the deployed Doha region. The rates used are the current on-demand rates for E2 vCPU, E2 RAM, balanced persistent disk, and Standard Cloud Storage. Google publishes that compute, persistent disk, storage, network, and usage are separately metered; the total excludes taxes and account-specific discounts. The live verification on the same date confirmed that the Cloudflare Quick Tunnel service is inactive.

- [Compute Engine pricing](https://cloud.google.com/products/compute/pricing)
- [Cloud Storage pricing](https://cloud.google.com/storage/pricing)
- [Google Cloud Observability pricing](https://cloud.google.com/products/observability)
- [Secret Manager pricing](https://cloud.google.com/secret-manager/pricing)

This document does not expose credentials, invoice identifiers, internal usage records, or personal data. It should be updated from a billing export after the first complete billing month and whenever the verified infrastructure changes.

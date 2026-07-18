# HR ERP Google Cloud inventory

Verified deployment target: project `hr-erp-502412`, VM `hrerp1` in `me-central1-b`.

- The application runs only in `/opt/medtech-hr-erp` under the `medtech-hr-erp` Compose project.
- Frontend, API, and PostgreSQL bind only to loopback. IAP is the only SSH ingress; Cloudflare Quick Tunnel is the public edge.
- The VM uses the `hr-erp-runtime` service account. Runtime secrets remain in Secret Manager; backup uploads use the dedicated `hr-erp-backup` identity.
- `hr-erp-502412-documents` and `hr-erp-502412-backups` use uniform bucket-level access and public-access prevention. Both buckets require versioning and 30-day soft deletion; backups retain their existing seven-day object-retention policy.
- Systemd runs the Cloudflare service, hourly database backups, and the five-minute health publisher. Google Cloud Monitoring checks the public health endpoint and alerts on component, resource, backup, scanner, and authentication failures.

The Quick Tunnel URL is intentionally not recorded here: it changes whenever the Cloudflare service restarts. Do not restart it during application-only deployments.

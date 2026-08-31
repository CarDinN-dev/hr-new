# Security-owner production decisions

These controls require identity, network, data-retention, cost, or lockout authority. The repository changes do not apply them automatically. Record the approver and rollback owner before execution.

## CYB-006 — private origin and managed edge

Preferred target: a named Cloudflare Tunnel for `hr.med-tech.com`, with the connector initiating outbound traffic and GCP ingress to TCP 80/443 removed. Keep IAP SSH, validate Google API egress, and retain the current origin only through the rollback window. A GCP external HTTPS load balancer plus Cloud Armor is the approved alternative if Cloudflare ownership or SLA is unavailable.

Preflight: confirm Cloudflare zone ownership, a stable named-tunnel credential in Secret Manager, OAuth redirect continuity, certificate/DNS rollback values, monitoring ownership, and an operator with IAP access. Canary the tunnel while direct ingress remains available; then restrict origin ingress and prove the public site, API health, login/logout, Microsoft callback, uploads, and rate controls. Roll back DNS/firewall together if any check fails.

## CYB-009 — release and baseline retention

Data Protection must classify the existing `releases/` objects before deletion because they contain database and HR-document copies. Quarantine approved evidence under backup controls; securely dispose of unapproved duplicates only after legal-hold review. Once approved, add prefix lifecycle rules of 35 days for verified PII-free `releases/` content and 400 days for `security-baselines/`, then test soft-deletion and recovery with synthetic objects.

## CYB-011 — Microsoft Entra governance

Assign two active accountable owners to each HR ERP app registration and enterprise application. Verify licensing, put the intended Conditional Access policy in report-only mode, review sign-in impact, then require phishing-resistant authentication for privileged roles and MFA for the HR ERP population. Keep two cloud-only break-glass accounts excluded, strongly protected, monitored, and tested. Record app-consent, credential-expiry, owner-removal, and break-glass alerts before enforcement.

## CYB-012 — OS Login and stale host identities

Export the current OS Login/IAP principals, local accounts, sudoers, and Docker-group membership. An owner must confirm every retained identity and that every administrator has Google 2-Step Verification before setting project metadata `enable-oslogin-2fa=TRUE`. Remove stale local accounts and Docker membership only after confirming no timers, files, or recovery procedure depends on them. Test a second IAP session before closing the first and retain a documented console recovery path.

## CYB-020 — log retention and encryption decision

Keep `_Required` locked at 400 days. The recommended operational baseline is 90 days for `_Default`, with a monthly ingestion/cost review and a sampled historical-search exercise. Google-managed encryption is the default unless Legal or Security requires customer-controlled revocation; CMEK must not be enabled until the KMS key, key administrators, monitoring, rotation, deletion protection, and outage recovery are owned and tested.

## Closure evidence

Attach the change ticket, approver, pre/post configuration exports, synthetic acceptance results, notification-channel receipt, rollback result, and next review date to the risk register. A control remains `Not Verified` until this evidence exists.

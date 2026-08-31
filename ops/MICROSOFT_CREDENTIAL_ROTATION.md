# Microsoft credential rotation

The provisioning and mail applications use certificate assertions. Interactive Microsoft SSO retains its client secret. Production monitoring reads these non-secret `.env` values:

```text
MICROSOFT_PROVISIONING_CERTIFICATE_FILE=/etc/medtech-hr-erp/provisioning.crt
MAIL_GRAPH_CERTIFICATE_FILE=/etc/medtech-hr-erp/mail.crt
MICROSOFT_CLIENT_SECRET_EXPIRES_AT=2027-01-01T00:00:00Z
```

Cloud Monitoring alerts must notify the operations channel at 90, 60, 30, and 7 days before any value reaches zero. A missing or unreadable value reports `-1` and must be treated as a configuration failure.

## Certificate rotation

1. Keep the current certificate active. Generate a new RSA certificate and a root-owned mode-600 private key in `/etc/medtech-hr-erp`; record its SHA-1 thumbprint and expiry.
2. Add the public certificate to the same Entra application without removing the current credential. Export the application credential list before this change.
3. Update the corresponding private-key, public-certificate, and thumbprint `.env` values. Run `ops/production.sh preflight`, deploy, and perform the positive Graph canary. For provisioning, repeat the same user to prove assignment idempotency. For mail, send only from `no-reply@med-tech.com` and verify the mail app is denied for `marketing@med-tech.com`.
4. After production succeeds, remove the old public certificate from Entra. Keep its private key in the root-only rollback store for seven days, then securely remove it.
5. If the canary fails, restore the previous `.env` values and redeploy before removing either Entra credential.

## Interactive SSO secret rotation

1. Create the replacement secret while the current secret remains valid, and export the application credential list.
2. Add a new Secret Manager version to `hr-erp-microsoft-client-secret`, set the next rotation time, and update `MICROSOFT_CLIENT_SECRET_EXPIRES_AT`.
3. Deploy and complete a fresh Microsoft sign-in plus step-up flow.
4. Remove the old Entra secret only after those checks pass. Disable its old Secret Manager version after the seven-day observation period.
5. On failure, re-enable the prior Secret Manager version and redeploy; do not delete the old Entra secret.

Never rotate the last valid credential, remove an old credential before a live canary, or store a private key in Secret Manager accessible to the VM runtime service account.

## Mail permission rollback

If the scoped Exchange Application RBAC canary fails after removing the broad Microsoft Graph grant, immediately restore it from an authenticated administrator shell:

```powershell
az rest --method post --url "https://graph.microsoft.com/v1.0/servicePrincipals/9b0fff0c-4ea4-44d1-a1e1-20fc197a7ed7/appRoleAssignments" --headers "Content-Type=application/json" --body '{"principalId":"9b0fff0c-4ea4-44d1-a1e1-20fc197a7ed7","resourceId":"391636f7-676a-4db7-85da-19244713af56","appRoleId":"b633e1c5-b582-4048-a93e-9f11b44c7e96"}'
```

Re-run both canaries after regranting. `no-reply@med-tech.com` must return HTTP 202; `marketing@med-tech.com` must remain blocked before the broad grant is removed again.

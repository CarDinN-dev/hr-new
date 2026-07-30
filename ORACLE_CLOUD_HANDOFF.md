# Oracle Cloud deployment handoff

## What this workspace confirms

This project originally documented Oracle Cloud as its deployment target. Those
instructions existed from the initial project commit on 2026-07-11 until they
were replaced with Google Cloud guidance on 2026-07-14.

No retained Oracle Cloud login or resource configuration was found on this PC.
In particular, there is no OCI CLI configuration directory, saved OCI
credential target, Oracle/OCI SSH host alias, or Oracle/OCI command in the
available PowerShell history.

`C:\ProgramData\Oracle` contains Java only. The only installed Oracle-branded
application is VirtualBox; neither is Oracle Cloud access.

## Recovered Oracle deployment requirements

- Set all values in the application's `.env`; do not use demo passwords.
- In the Oracle security list, make only ports 80 and 443 publicly reachable.
- Keep the PostgreSQL and API host ports private.
- Use a real TLS certificate in Nginx, or terminate TLS at an Oracle load
  balancer.
- Deploy with `docker compose pull && docker compose up -d --build`, then
  verify with `docker compose ps`.
- Back up the Docker volume named `postgres_data` before upgrades and payroll
  runs.
- Copy PostgreSQL disaster-recovery dumps to a private Oracle Object Storage
  bucket.
- Leave `CORS_ORIGIN` empty when the frontend proxies `/api/v1` from the same
  domain.

## Required before any OCI login or deployment

Ask the account owner for these values or have them run `oci setup config` on
this machine:

- OCI tenancy OCID
- user OCID
- home region
- compartment OCID
- authentication method: browser/device login, API signing key, or instance
  principal
- the target compute instance's public IP/DNS and SSH user, if deploying to an
  existing VM
- bucket name/namespace and a least-privilege policy for backups

Do not guess or fabricate any of these values. Do not put private keys,
passwords, API signing keys, or `.env` values in this file or in Git.

## Current project status

This HR ERP is now deployed through Google Cloud, not OCI. These notes are
historical guidance for a separate application only.

## Source history

- `65faadc` (2026-07-11): initial Oracle deployment checklist.
- `cd9e802` (2026-07-12): added Cloudflare/private-port and Oracle Object
  Storage backup guidance.
- `59bf29b` (2026-07-14): replaced the Oracle checklist with Google Cloud.

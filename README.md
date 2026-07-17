# MedTech HR ERP

Production-oriented HR-only ERP built from the supplied MedTech HR references.

## Local development

```powershell
# Terminal 1: PostgreSQL and backend
docker compose up -d postgres
cd backend
npm install
Copy-Item .env.example .env
# Set DATABASE_URL to localhost:5434 and provide development secrets.
npm run prisma:generate
npm run prisma:deploy
npm run start:dev

# Terminal 2: Vite frontend
cd ..
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `http://127.0.0.1:3000`, and frontend requests include credentials for both same-origin and explicitly configured cross-origin development. If a different backend origin is required, set `VITE_API_URL` and include the frontend origin in backend `CORS_ORIGIN`.

## Docker

```powershell
Copy-Item .env.example .env
# edit .env and set strong secrets first
docker compose up -d --build

# First installation only: create missing login accounts. This temporary
# command exits after seeding and does not create another running app stack.
docker compose run --rm --env-from-file .env api npm run seed
```

Open `http://localhost:8080`. The compose stack starts:

- `hr-erp`: React/Vite frontend served by Nginx on port `8080`
- `api`: NestJS HR API on host port `3100`
- `postgres`: PostgreSQL on host port `5434`

The API is proxied through the frontend at `/api/v1`. Swagger is disabled in production unless `ENABLE_SWAGGER=true` is set. Database migrations run automatically when the API container starts; login bootstrapping is deliberately manual so a restart cannot recreate, reactivate, or reset privileged accounts.

## Cloudflare Quick Tunnel

The Quick Tunnel exposes the loopback-only app on port `8080` at a temporary public HTTPS URL. It requires no domain or router changes and is intended only for testing and demonstrations. The existing JWT sessions, permission and resource-scope checks, CSRF protection, and API authorization remain active; anyone with the URL can reach the login screen, so use strong passwords from the gitignored `.env` file.

On Windows:

```powershell
npm run tunnel:start
npm run tunnel:status
npm run tunnel:stop
```

On macOS or Linux:

```sh
sh scripts/cloudflare/start-tunnel.sh
sh scripts/cloudflare/stop-tunnel.sh
```

The start script launches the Compose app when needed, waits for `/healthz`, starts `cloudflared`, prints the public URL, and saves it to `.cloudflare-tunnel-url`. The URL changes each time the tunnel restarts. Logs are under `cloudflare-logs/`. The stop script terminates only the recorded tunnel process, restores any temporarily renamed `~/.cloudflared/config.yml` or `config.yaml`, and stops the Compose app only when the start script launched it. Verify shutdown with `npm run tunnel:status`.

Changing bootstrap password variables does not rotate an existing account. Rotate an existing password through the protected account workflow or an approved administrative procedure. Never commit `.env`, tunnel logs, or runtime files.

## Google Cloud deployment checklist

- Set every value in `.env`; do not use sample or shared passwords.
- Keep the application, API and PostgreSQL ports bound to `127.0.0.1`; a Cloudflare Tunnel needs outbound access only.
- Restrict SSH to the administrator IP and do not add public ingress rules for `3000`, `3100`, `5432`, `5434`, `8080` or `8443`.
- Rebuild the existing Compose project with `docker compose -p medtech-hr-erp -f docker-compose.yml -f docker-compose.production.yml up -d --build`; do not start a second stack.
- Check `docker compose -p medtech-hr-erp -f docker-compose.yml -f docker-compose.production.yml ps` and both `/healthz` and `/api/v1/health` after deployment.
- Set `MICROSOFT_LOGIN_ENABLED=false` for local-only authentication. When it is `true`, all Microsoft tenant, client, secret, and redirect variables are mandatory and startup fails if any are missing.
- Set `GCS_DOCUMENTS_BUCKET` to a private bucket. Production startup fails if the bucket name is missing.
- Keep `CORS_ORIGIN` empty when the frontend proxies `/api/v1` from the same domain.
- Do not restart the Cloudflare tunnel during an application-only deployment; a Quick Tunnel URL can change when its process restarts.

## Guided role assignment

The System page contains an Admin/Super Admin-only role flow for standard operational access. It always assigns `EMPLOYEE`, guides direct-report and management-tree access through `LINE_MANAGER` and `MANAGER`, and optionally assigns `HR`. `CPO`, `COO`, `ADMIN`, `SUPER_ADMIN`, and custom roles are locked and preserved by the flow. The backend rechecks the administrator role, rejects self-assignment and stale versions, records the reason, and revokes the target user's sessions. Reporting lines are separate: use the preview-first organization remediation workflow to change `Employee.managerId`.

## Backup and restore operator procedure

Production runs an hourly systemd backup timer through `ops/backup.sh`. Each custom-format PostgreSQL dump has a SHA-256 manifest and is uploaded through the dedicated backup identity to daily, weekly, and monthly recovery prefixes. Do not run backup or regression scripts against an unguarded production database.

Production operations are consolidated in `ops/production.sh`. On the existing host, run `sudo PROJECT_DIR=/opt/medtech-hr-erp bash ops/production.sh preflight` before any release and `sudo bash ops/production.sh deploy` for the guarded backup, migration, staged service restart, health verification, and image rollback path. The malware scanner must be healthy before the API is recreated; uploaded files remain unavailable until their persisted scan state is `CLEAN`.

For a restore drill, download one `hr_erp.dump` and its matching `manifest.json` using an auditor identity, then run `sudo bash ops/production.sh restore-drill /path/hr_erp.dump /path/manifest.json`. The command verifies the manifest checksum, restores into a temporary private PostgreSQL network, applies newer migrations, boots the real API image, runs its health check and financial regression, reports integrity counts, and deletes every temporary container, network, and volume.

For an actual recovery, stop application writes, verify the dump checksum, restore into a newly created database, validate migrations and record counts, then switch the API only after the restore test succeeds. Recover document objects from GCS generations according to the bucket retention policy.

## Checks

```powershell
npm run test
npm run build
cd backend
npm run prisma:generate
npm run build
npm run lint
npm run test:security
cd ..
docker compose config
```

The app saves HR data to PostgreSQL through the backend. Browser JSON import/export is intentionally disabled; backup and restore remain infrastructure-operator responsibilities.

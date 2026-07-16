# MedTech HR ERP

Production-oriented HR-only ERP built from the supplied MedTech HR references.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`.

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
- The backend keeps up to 90 workspace snapshots, runs one every eight hours, and supports manual backup and rollback from Settings.
- Copy encrypted PostgreSQL disaster-recovery dumps and uploaded-document backups to a private, versioned Google Cloud Storage bucket; application snapshots in the same database do not protect against disk or VM loss.
- Keep `CORS_ORIGIN` empty when the frontend proxies `/api/v1` from the same domain.
- Do not restart the Cloudflare tunnel during an application-only deployment; a Quick Tunnel URL can change when its process restarts.

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

The app saves HR data to PostgreSQL through the backend. Browser JSON import/export is intentionally disabled; use the protected Settings backup controls.

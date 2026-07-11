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
```

Open `http://localhost:8080`. The compose stack starts:

- `hr-erp`: React/Vite frontend served by Nginx on port `8080`
- `api`: NestJS HR API on host port `3100`
- `postgres`: PostgreSQL on host port `5434`

The API is proxied through the frontend at `/api/v1`. Swagger is disabled in production unless `ENABLE_SWAGGER=true` is set.

## Cloudflare Quick Tunnel

The Quick Tunnel exposes the loopback-only app on port `8080` at a temporary public HTTPS URL. It requires no domain or router changes and is intended only for testing and demonstrations. The existing JWT login, role checks, CSRF checks, and API authorization remain active; anyone with the URL can reach the login screen, so use strong passwords from the gitignored `.env` file.

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

Rotate access by changing the password values in `.env`, then recreate the API container with `docker compose up -d --force-recreate api`. Never commit `.env`, tunnel logs, or runtime files.

## Oracle deployment checklist

- Set every value in `.env`; do not use demo passwords for Oracle.
- Open only `80`/`443` publicly in the Oracle security list; keep Postgres and API host ports private.
- Put a real certificate in Nginx or terminate TLS at Oracle/load balancer. The generated certificate is local-only.
- Run `docker compose pull && docker compose up -d --build`, then check `docker compose ps`.
- Back up the Docker volume `postgres_data` before upgrades and payroll runs.
- Keep `CORS_ORIGIN` empty when the frontend proxies `/api/v1` from the same domain.

## Checks

```powershell
npm run test
npm run build
cd backend
npm run prisma:generate
npm run build
cd ..
docker compose config
```

The app saves HR data to PostgreSQL through the backend. Use Backup / Restore for manual JSON exports before payroll runs or upgrades.

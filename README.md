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

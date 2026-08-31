#!/usr/bin/env bash
set -euo pipefail

backend_dir=${1:?Usage: integration-isolated.sh BACKEND_DIRECTORY}
run_id="hr-erp-audit-$(date -u +%Y%m%dt%H%M%Sz)-$$"
network=$run_id
database="$run_id-postgres"
image="$run_id-backend"
password=$(openssl rand -hex 24)

cleanup() {
  docker rm -f "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" --network-alias audit-postgres \
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=512m \
  -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=hr_erp postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777 >/dev/null
for _ in {1..60}; do
  docker exec "$database" pg_isready -U postgres -d hr_erp >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$database" pg_isready -U postgres -d hr_erp >/dev/null
docker build --target builder -t "$image" "$backend_dir"
docker run --rm --network "$network" \
  -e "INTEGRATION_DATABASE_URL=postgresql://postgres:$password@audit-postgres:5432/hr_erp" \
  -e ALLOW_REMOTE_INTEGRATION_DB=true "$image" npm run test:integration

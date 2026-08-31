#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "$0")/.." && pwd)
container="hr-erp-database-roles-test-$$"
admin_password=$(openssl rand -hex 24)
migrator_password=$(openssl rand -hex 24)
app_password=$(openssl rand -hex 24)
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$container" -e POSTGRES_PASSWORD="$admin_password" -e POSTGRES_DB=hr_erp postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685 >/dev/null
for _ in {1..60}; do
  docker exec "$container" pg_isready -U postgres -d hr_erp >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$container" pg_isready -U postgres -d hr_erp >/dev/null
docker exec -i -e PGPASSWORD="$admin_password" "$container" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d hr_erp <<'SQL' >/dev/null
CREATE TYPE "SampleState" AS ENUM ('ACTIVE');
CREATE TABLE "Sample" (id integer PRIMARY KEY, state "SampleState" NOT NULL);
CREATE TABLE "_prisma_migrations" (id text PRIMARY KEY);
CREATE SEQUENCE "SampleSequence";
CREATE FUNCTION sample_identity(value integer) RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT value';
SQL

docker exec -i -e PGPASSWORD="$admin_password" -e HR_ERP_MIGRATOR_PASSWORD="$migrator_password" -e HR_ERP_APP_PASSWORD="$app_password" \
  "$container" psql -h 127.0.0.1 -U postgres -d hr_erp <"$project_dir/ops/database-roles.sql" >/dev/null

docker exec -e PGPASSWORD="$app_password" "$container" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U hr_erp_app -d hr_erp \
  -c 'INSERT INTO "Sample" (id, state) VALUES (1, '\''ACTIVE'\''); SELECT * FROM "Sample";' >/dev/null
[[ $(docker exec -e PGPASSWORD="$admin_password" "$container" psql -h 127.0.0.1 -U postgres -d hr_erp -Atc \
  'SELECT tableowner FROM pg_tables WHERE schemaname = '\''public'\'' AND tablename = '\''Sample'\''') == hr_erp_migrator ]]

if docker exec -e PGPASSWORD="$app_password" "$container" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U hr_erp_app -d hr_erp -c 'CREATE TABLE public.forbidden(id integer)' >/dev/null 2>&1; then
  echo 'hr_erp_app unexpectedly created a table.' >&2
  exit 1
fi
if docker exec -e PGPASSWORD="$app_password" "$container" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U hr_erp_app -d hr_erp -c 'CREATE ROLE forbidden' >/dev/null 2>&1; then
  echo 'hr_erp_app unexpectedly created a role.' >&2
  exit 1
fi
if docker exec -e PGPASSWORD="$app_password" "$container" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U hr_erp_app -d hr_erp -c 'TRUNCATE TABLE "Sample"' >/dev/null 2>&1; then
  echo 'hr_erp_app unexpectedly truncated a table.' >&2
  exit 1
fi
if docker exec -e PGPASSWORD="$app_password" "$container" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U hr_erp_app -d hr_erp -c 'SELECT * FROM "_prisma_migrations"' >/dev/null 2>&1; then
  echo 'hr_erp_app unexpectedly read migration metadata.' >&2
  exit 1
fi

docker exec -e PGPASSWORD="$migrator_password" "$container" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U hr_erp_migrator -d hr_erp -c 'CREATE TABLE public."FutureTable" (id integer PRIMARY KEY)' >/dev/null
docker exec -e PGPASSWORD="$app_password" "$container" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U hr_erp_app -d hr_erp -c 'INSERT INTO "FutureTable" VALUES (1)' >/dev/null

echo 'Database role regression passed.'

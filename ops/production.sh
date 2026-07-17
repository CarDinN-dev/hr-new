#!/usr/bin/env bash
set -euo pipefail

project_dir=${PROJECT_DIR:-/opt/medtech-hr-erp}
runtime_env=/run/medtech-hr-erp/runtime.env
compose=(docker compose --env-file "$runtime_env" -f "$project_dir/docker-compose.yml" -f "$project_dir/docker-compose.production.yml")

cleanup_runtime_env() { rm -f "$runtime_env"; }

load_runtime_env() {
  command -v gcloud >/dev/null || { echo 'gcloud is required to load production secrets.' >&2; exit 1; }
  command -v python3 >/dev/null || { echo 'python3 is required to load production secrets.' >&2; exit 1; }
  install -d -m 700 "$(dirname "$runtime_env")"
  local key secret value
  umask 077
  awk -F= '!/^(POSTGRES_PASSWORD|JWT_SECRET|AUDIT_HMAC_KEY|MICROSOFT_CLIENT_SECRET|MICROSOFT_PROVISIONING_CLIENT_SECRET)=/' "$project_dir/.env" >"$runtime_env"
  chmod 600 "$runtime_env"
  while IFS=':' read -r key secret; do
    [[ -n $key && -n $secret ]] || continue
    value=$(gcloud secrets versions access latest --secret="$secret" --quiet)
    [[ $value != *$'\n'* && $value != *$'\r'* ]] || { echo "Secret $secret contains unsupported line breaks." >&2; exit 1; }
    printf '%s' "$value" | python3 -c 'import json,sys; print(f"{sys.argv[1]}={json.dumps(sys.stdin.read())}")' "$key" >>"$runtime_env"
  done <<'SECRETS'
POSTGRES_PASSWORD:hr-erp-postgres-password
JWT_SECRET:hr-erp-jwt-secret
AUDIT_HMAC_KEY:hr-erp-audit-hmac-key
MICROSOFT_CLIENT_SECRET:hr-erp-microsoft-client-secret
MICROSOFT_PROVISIONING_CLIENT_SECRET:hr-erp-microsoft-provisioning-client-secret
SECRETS
}

preflight() {
  [[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
  cd "$project_dir"
  for command in docker curl sha256sum awk stat openssl; do command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }; done
  [[ -f .env && $(stat -c '%a' .env) == 600 ]] || { echo '.env must exist with mode 600.' >&2; exit 1; }
  local free_kb available_kb
  free_kb=$(df -Pk "$project_dir" | awk 'NR==2 {print $4}')
  available_kb=$(awk '/MemAvailable/ {print $2}' /proc/meminfo)
  (( free_kb >= 5 * 1024 * 1024 )) || { echo 'At least 5 GiB free disk is required.' >&2; exit 1; }
  (( available_kb >= 2 * 1024 * 1024 )) || { echo 'At least 2 GiB available memory is required.' >&2; exit 1; }
  "${compose[@]}" config --quiet
  docker inspect --format '{{.State.Health.Status}}' medtech-hr-erp-postgres-1 | grep -qx healthy
  systemctl is-active --quiet medtech-hr-erp-backup.timer
  local backup_age
  backup_age=$(( $(date +%s) - $(systemctl show medtech-hr-erp-backup.service -p ExecMainExitTimestamp --value | xargs -I{} date -d '{}' +%s) ))
  (( backup_age <= 36 * 60 * 60 )) || { echo 'Latest successful backup is older than 36 hours.' >&2; exit 1; }
}

backup() {
  systemctl start medtech-hr-erp-backup.service
  systemctl is-failed --quiet medtech-hr-erp-backup.service && { journalctl -u medtech-hr-erp-backup.service -n 80 --no-pager; exit 1; }
  systemctl show medtech-hr-erp-backup.service -p Result --value | grep -qx success
}

wait_healthy() {
  local container=$1 attempts=${2:-60}
  for (( attempt=1; attempt<=attempts; attempt++ )); do
    [[ $(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || true) == healthy ]] && return 0
    sleep 5
  done
  docker logs --tail 100 "$container" || true
  return 1
}

deploy() {
  preflight
  backup
  cd "$project_dir"
  local stamp old_api old_web
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  old_api=$(docker image inspect medtech-hr-erp-api:latest --format '{{.Id}}')
  old_web=$(docker image inspect medtech-hr-erp:latest --format '{{.Id}}')
  docker tag "$old_api" "medtech-hr-erp-api:rollback-$stamp"
  docker tag "$old_web" "medtech-hr-erp:rollback-$stamp"
  rollback() {
    docker tag "medtech-hr-erp-api:rollback-$stamp" medtech-hr-erp-api:latest
    docker tag "medtech-hr-erp:rollback-$stamp" medtech-hr-erp:latest
    "${compose[@]}" up -d --no-deps api hr-erp
    echo "Deployment failed; application images rolled back to $stamp." >&2
  }
  trap rollback ERR
  "${compose[@]}" pull clamav
  "${compose[@]}" up -d clamav
  wait_healthy medtech-hr-erp-clamav-1 180
  "${compose[@]}" build api hr-erp
  "${compose[@]}" run --rm --no-deps api npx prisma migrate deploy
  "${compose[@]}" up -d --no-deps api
  wait_healthy medtech-hr-erp-api-1
  "${compose[@]}" up -d --no-deps hr-erp
  wait_healthy medtech-hr-erp-hr-erp-1
  curl --fail --silent --show-error http://127.0.0.1/healthz >/dev/null
  curl --fail --silent --show-error http://127.0.0.1/api/v1/health >/dev/null
  trap - ERR
  echo "Deployment $stamp passed local health checks."
}

restore_drill() {
  local dump=${1:?Usage: production.sh restore-drill DUMP MANIFEST} manifest=${2:?Usage: production.sh restore-drill DUMP MANIFEST}
  command -v python3 >/dev/null || { echo 'python3 is required.' >&2; exit 1; }
  [[ -s $dump && -s $manifest ]] || { echo 'Dump or manifest is missing.' >&2; exit 1; }
  local expected actual container app_container network volume password jwt audit_key
  expected=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["databaseSha256"])' "$manifest")
  actual=$(sha256sum "$dump" | awk '{print $1}')
  [[ $actual == "$expected" ]] || { echo 'Backup checksum mismatch.' >&2; exit 1; }
  container="medtech-restore-drill-$(date +%s)"; app_container="$container-api"; network="$container-net"; volume="$container"; password=$(openssl rand -hex 24); jwt=$(openssl rand -hex 32); audit_key=$(openssl rand -hex 32)
  cleanup() { docker rm -f "$app_container" "$container" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; docker volume rm "$volume" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  docker volume create "$volume" >/dev/null
  docker network create "$network" >/dev/null
  docker run -d --name "$container" --network "$network" --network-alias postgres -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=hr_erp_restore -v "$volume:/var/lib/postgresql/data" postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777 >/dev/null
  for _ in {1..60}; do docker exec "$container" pg_isready -U postgres -d hr_erp_restore >/dev/null 2>&1 && break; sleep 2; done
  docker exec "$container" pg_isready -U postgres -d hr_erp_restore >/dev/null
  docker cp "$dump" "$container:/tmp/hr_erp.dump"
  docker exec "$container" pg_restore -U postgres -d hr_erp_restore --no-owner --no-privileges /tmp/hr_erp.dump
  docker run --rm --network "$network" -e DATABASE_URL="postgresql://postgres:$password@postgres:5432/hr_erp_restore?schema=public" medtech-hr-erp-api:latest npx prisma migrate deploy >/dev/null
  docker run -d --name "$app_container" --network "$network" --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges:true \
    -e NODE_ENV=test -e PORT=3000 -e DATABASE_URL="postgresql://postgres:$password@postgres:5432/hr_erp_restore?schema=public" -e JWT_SECRET="$jwt" -e AUDIT_HMAC_KEY="$audit_key" -e DOCUMENT_SCAN_ENABLED=false medtech-hr-erp-api:latest >/dev/null
  for _ in {1..60}; do docker exec "$app_container" node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && break; sleep 2; done
  docker exec "$app_container" node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  docker exec "$app_container" node scripts/financial-regression.js
  docker exec "$container" psql -U postgres -d hr_erp_restore -v ON_ERROR_STOP=1 -Atc 'SELECT COUNT(*) FROM "_prisma_migrations"; SELECT COUNT(*) FROM "Employee"; SELECT COUNT(*) FROM "AuditEvent";'
  echo 'Isolated restore drill passed.'
  cleanup
  trap - EXIT
}

case ${1:-} in
  preflight) trap cleanup_runtime_env EXIT; load_runtime_env; preflight ;;
  backup) trap cleanup_runtime_env EXIT; load_runtime_env; preflight; backup ;;
  deploy) trap cleanup_runtime_env EXIT; load_runtime_env; deploy ;;
  restore-drill) shift; restore_drill "$@" ;;
  *) echo 'Usage: production.sh preflight|backup|deploy|restore-drill DUMP MANIFEST' >&2; exit 2 ;;
esac

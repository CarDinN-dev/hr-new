#!/usr/bin/env bash
set -euo pipefail

project_dir=${PROJECT_DIR:-/opt/medtech-hr-erp}
runtime_env=/run/medtech-hr-erp/runtime.env
postgres_tls_dir=${POSTGRES_TLS_DIR:-/var/lib/medtech-hr-erp/postgres-tls}
export POSTGRES_TLS_DIR=$postgres_tls_dir
compose=(docker compose --env-file "$runtime_env" -f "$project_dir/docker-compose.yml" -f "$project_dir/docker-compose.production.yml")

cleanup_runtime_env() { rm -f "$runtime_env"; }

load_runtime_env() {
  command -v gcloud >/dev/null || { echo 'gcloud is required to load production secrets.' >&2; exit 1; }
  command -v python3 >/dev/null || { echo 'python3 is required to load production secrets.' >&2; exit 1; }
  install -d -m 700 "$(dirname "$runtime_env")"
  local key secret value
  umask 077
  awk -F= '!/^(POSTGRES_PASSWORD|DATABASE_APP_PASSWORD|DATABASE_MIGRATOR_PASSWORD|JWT_SECRET|AUDIT_HMAC_KEY|AUDIT_HMAC_PREVIOUS_KEYS|MICROSOFT_CLIENT_SECRET|MICROSOFT_PROVISIONING_CLIENT_SECRET)=/' "$project_dir/.env" >"$runtime_env"
  chmod 600 "$runtime_env"
  while IFS=':' read -r key secret; do
    [[ -n $key && -n $secret ]] || continue
    value=$(gcloud secrets versions access latest --secret="$secret" --quiet)
    [[ $value != *$'\n'* && $value != *$'\r'* ]] || { echo "Secret $secret contains unsupported line breaks." >&2; exit 1; }
    if [[ $key == DATABASE_*_PASSWORD && ! $value =~ ^[A-Za-z0-9._~-]{32,}$ ]]; then
      echo "Secret $secret must be at least 32 URL-safe characters." >&2
      exit 1
    fi
    printf -v "$key" '%s' "$value"
    export "$key"
    printf '%s' "$value" | python3 -c 'import json,sys; print(f"{sys.argv[1]}={json.dumps(sys.stdin.read())}")' "$key" >>"$runtime_env"
  done <<'SECRETS'
POSTGRES_PASSWORD:hr-erp-postgres-password
DATABASE_APP_PASSWORD:hr-erp-database-app-password
DATABASE_MIGRATOR_PASSWORD:hr-erp-database-migrator-password
JWT_SECRET:hr-erp-jwt-secret
AUDIT_HMAC_KEY:hr-erp-audit-hmac-key
AUDIT_HMAC_PREVIOUS_KEYS:hr-erp-audit-hmac-previous-keys
MICROSOFT_CLIENT_SECRET:hr-erp-microsoft-client-secret
SECRETS
  if grep -qx 'MICROSOFT_PROVISIONING_ENABLED=true' "$project_dir/.env"; then
    value=$(gcloud secrets versions access latest --secret=hr-erp-microsoft-provisioning-client-secret --quiet)
    [[ $value != *$'\n'* && $value != *$'\r'* ]] || { echo 'Microsoft provisioning secret contains unsupported line breaks.' >&2; exit 1; }
    MICROSOFT_PROVISIONING_CLIENT_SECRET=$value
    export MICROSOFT_PROVISIONING_CLIENT_SECRET
    printf '%s' "$value" | python3 -c 'import json,sys; print(f"MICROSOFT_PROVISIONING_CLIENT_SECRET={json.dumps(sys.stdin.read())}")' >>"$runtime_env"
  fi
}

configure_compose() {
  grep -qx 'LEAVE_EMAIL_ENABLED=true' "$runtime_env" || return 0
  [[ -f "$project_dir/docker-compose.mail.yml" ]] || { echo 'Mail compose overlay is missing.' >&2; exit 1; }
  compose+=(-f "$project_dir/docker-compose.mail.yml")
}

preflight() {
  [[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
  cd "$project_dir"
  for command in docker curl sha256sum awk stat openssl nginx cmp find systemctl iptables ip6tables ss; do command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }; done
  [[ -f .env && $(stat -c '%a' .env) == 600 ]] || { echo '.env must exist with mode 600.' >&2; exit 1; }
  local free_kb available_kb
  free_kb=$(df -Pk "$project_dir" | awk 'NR==2 {print $4}')
  available_kb=$(awk '/MemAvailable/ {print $2}' /proc/meminfo)
  (( free_kb >= 10 * 1024 * 1024 )) || { echo 'At least 10 GiB free disk is required.' >&2; exit 1; }
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

contain_local_artifacts() {
  chmod 750 "$project_dir"
  if [[ -d "$project_dir/backups" ]]; then
    chmod 700 "$project_dir/backups"
    find "$project_dir/backups" -type d -exec chmod 700 {} +
    find "$project_dir/backups" -type f -exec chmod 600 {} +
  fi
  find "$project_dir" -maxdepth 1 -type f \( -iname '*.pdf' -o -iname '*.dump' -o -iname '*.bak' -o -iname '*.sql' -o -iname '*.zip' \) -exec chmod 600 {} +
}

prepare_postgres_tls() {
  local postgres_uid postgres_gid tls_tmp
  install -d -m 750 "$postgres_tls_dir"
  postgres_uid=$("${compose[@]}" run --rm --no-deps --entrypoint sh postgres -c 'id -u postgres')
  postgres_gid=$("${compose[@]}" run --rm --no-deps --entrypoint sh postgres -c 'id -g postgres')
  chown "root:$postgres_gid" "$postgres_tls_dir"
  if [[ -s "$postgres_tls_dir/ca.crt" && -s "$postgres_tls_dir/ca.key" && -s "$postgres_tls_dir/server.crt" && -s "$postgres_tls_dir/server.key" ]] \
    && openssl x509 -checkend $((30 * 86400)) -noout -in "$postgres_tls_dir/server.crt"; then
    chown "$postgres_uid:$postgres_gid" "$postgres_tls_dir/server.crt" "$postgres_tls_dir/server.key"
    chmod 600 "$postgres_tls_dir/server.key"
    chmod 644 "$postgres_tls_dir/server.crt" "$postgres_tls_dir/ca.crt"
    return
  fi

  tls_tmp=$(mktemp -d "$postgres_tls_dir/.new.XXXXXX")
  umask 077
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 \
    -subj '/CN=MedTech HR ERP PostgreSQL CA' \
    -addext 'basicConstraints=critical,CA:TRUE' \
    -addext 'keyUsage=critical,keyCertSign,cRLSign' \
    -keyout "$tls_tmp/ca.key" -out "$tls_tmp/ca.crt" >/dev/null 2>&1
  openssl req -newkey rsa:3072 -sha256 -nodes -subj '/CN=postgres' \
    -keyout "$tls_tmp/server.key" -out "$tls_tmp/server.csr" >/dev/null 2>&1
  printf '%s\n' 'subjectAltName=DNS:postgres' 'basicConstraints=critical,CA:FALSE' \
    'keyUsage=critical,digitalSignature,keyEncipherment' 'extendedKeyUsage=serverAuth' >"$tls_tmp/server.ext"
  openssl x509 -req -sha256 -days 397 -in "$tls_tmp/server.csr" \
    -CA "$tls_tmp/ca.crt" -CAkey "$tls_tmp/ca.key" -CAcreateserial \
    -extfile "$tls_tmp/server.ext" -out "$tls_tmp/server.crt" >/dev/null 2>&1
  openssl verify -CAfile "$tls_tmp/ca.crt" -verify_hostname postgres "$tls_tmp/server.crt" >/dev/null

  install -m 600 "$tls_tmp/ca.key" "$postgres_tls_dir/ca.key"
  install -m 644 "$tls_tmp/ca.crt" "$postgres_tls_dir/ca.crt"
  install -o "$postgres_uid" -g "$postgres_gid" -m 600 "$tls_tmp/server.key" "$postgres_tls_dir/server.key"
  install -o "$postgres_uid" -g "$postgres_gid" -m 644 "$tls_tmp/server.crt" "$postgres_tls_dir/server.crt"
  rm -rf -- "$tls_tmp"
}

establish_database_roles() {
  "${compose[@]}" exec -T \
    -e HR_ERP_MIGRATOR_PASSWORD="$DATABASE_MIGRATOR_PASSWORD" \
    -e HR_ERP_APP_PASSWORD="$DATABASE_APP_PASSWORD" \
    postgres psql -U postgres -d hr_erp -v ON_ERROR_STOP=1 \
    <"$project_dir/ops/database-roles.sql" >/dev/null
}

database_url() {
  local role=$1 password=$2
  printf 'postgresql://%s:%s@postgres:5432/hr_erp?schema=public&sslmode=require&sslcert=postgres-ca.crt&sslaccept=strict' "$role" "$password"
}

verify_runtime_database_role() {
  docker exec medtech-hr-erp-api-1 node -e 'const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();p.$queryRawUnsafe("SELECT current_user AS \"roleName\", rolsuper FROM pg_roles WHERE rolname = current_user").then(([r])=>{if(r.roleName!=="hr_erp_app"||r.rolsuper)process.exitCode=1}).finally(()=>p.$disconnect())'
}

verify_database_transport() {
  local encrypted
  encrypted=$("${compose[@]}" exec -T postgres psql -U postgres -d hr_erp -Atc \
    "SELECT COUNT(*) FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid) WHERE a.usename = 'hr_erp_app' AND s.ssl")
  (( encrypted > 0 )) || { echo 'No encrypted application database connection was observed.' >&2; return 1; }
  if docker exec -e PGPASSWORD="$DATABASE_APP_PASSWORD" medtech-hr-erp-postgres-1 \
    psql 'postgresql://hr_erp_app@postgres:5432/hr_erp?sslmode=disable' -Atc 'SELECT 1' >/dev/null 2>&1; then
    echo 'PostgreSQL accepted a plaintext application connection.' >&2
    return 1
  fi
}

install_edge_config() {
  local source="$project_dir/ops/hr-med-tech-http.conf" target=/etc/nginx/sites-available/hr.med-tech.com.conf backup_dir
  [[ -e "$target" && -e /etc/nginx/sites-enabled/hr.med-tech.com.conf ]] || { echo 'Expected installed Nginx site is missing; refusing to guess its path.' >&2; return 1; }
  backup_dir=$(mktemp -d /run/medtech-nginx.XXXXXX)
  cp -a "$target" "$backup_dir/hr-med-tech"
  install -m 644 "$source" "$target"
  if ! nginx -t || ! systemctl reload nginx \
    || ! curl --fail --silent --show-error --resolve hr.med-tech.com:443:127.0.0.1 https://hr.med-tech.com/api/v1/health >/dev/null; then
    install -m 644 "$backup_dir/hr-med-tech" "$target"
    nginx -t && systemctl reload nginx
    rm -rf -- "$backup_dir"
    echo 'Nginx reconciliation failed and the previous configuration was restored.' >&2
    return 1
  fi
  cmp -s "$source" "$target"
  rm -rf -- "$backup_dir"
}

install_host_network_hardening() {
  install -D -m 755 "$project_dir/ops/host-network-hardening.sh" /usr/local/sbin/medtech-hr-erp-host-network-hardening
  install -D -m 644 "$project_dir/ops/systemd/medtech-resolved.conf" /etc/systemd/resolved.conf.d/medtech-hr-erp.conf
  install -m 644 "$project_dir/ops/systemd/medtech-hr-erp-host-network.service" /etc/systemd/system/medtech-hr-erp-host-network.service
  systemctl daemon-reload
  systemctl restart systemd-resolved
  systemctl enable --now medtech-hr-erp-host-network.service
}

install_monitoring() {
  install -m 755 "$project_dir/ops/health-monitor.sh" /usr/local/sbin/medtech-hr-erp-monitor
  install -m 644 "$project_dir/ops/systemd/medtech-hr-erp-monitor.service" /etc/systemd/system/medtech-hr-erp-monitor.service
  install -m 644 "$project_dir/ops/systemd/medtech-hr-erp-monitor.timer" /etc/systemd/system/medtech-hr-erp-monitor.timer
  systemctl daemon-reload
  systemctl enable --now medtech-hr-erp-monitor.timer
  systemctl start medtech-hr-erp-monitor.service
  GOOGLE_CLOUD_PROJECT=hr-erp-502412 python3 "$project_dir/ops/gcp/reconcile-monitoring.py" --apply >/dev/null
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
  contain_local_artifacts
  cd "$project_dir"
  local stamp old_api old_web migrator_url api_id web_id
  if [[ -z ${DEPLOYED_COMMIT:-} ]]; then
    command -v git >/dev/null || { echo 'Set DEPLOYED_COMMIT when deploying a source archive.' >&2; return 1; }
    DEPLOYED_COMMIT=$(git rev-parse HEAD)
  fi
  export DEPLOYED_COMMIT
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  old_api=$(docker image inspect medtech-hr-erp-api:latest --format '{{.Id}}')
  old_web=$(docker image inspect medtech-hr-erp:latest --format '{{.Id}}')
  docker tag "$old_api" "medtech-hr-erp-api:rollback-$stamp"
  docker tag "$old_web" "medtech-hr-erp:rollback-$stamp"
  rollback() {
    docker tag "medtech-hr-erp-api:rollback-$stamp" medtech-hr-erp-api:latest
    docker tag "medtech-hr-erp:rollback-$stamp" medtech-hr-erp:latest
    "${compose[@]}" up -d --force-recreate --no-deps api hr-erp
    echo "Deployment failed; application images rolled back to $stamp." >&2
  }
  trap rollback ERR
  "${compose[@]}" pull postgres clamav
  "${compose[@]}" build api hr-erp
  prepare_postgres_tls
  "${compose[@]}" up -d --force-recreate postgres clamav
  wait_healthy medtech-hr-erp-postgres-1
  wait_healthy medtech-hr-erp-clamav-1 180
  establish_database_roles
  migrator_url=$(database_url hr_erp_migrator "$DATABASE_MIGRATOR_PASSWORD")
  "${compose[@]}" run --rm --no-deps -e DATABASE_URL="$migrator_url" api npx prisma migrate deploy
  establish_database_roles
  "${compose[@]}" run --rm --no-deps api npm run rbac:sync
  "${compose[@]}" up -d --force-recreate --no-deps api
  wait_healthy medtech-hr-erp-api-1
  "${compose[@]}" up -d --force-recreate --no-deps hr-erp
  wait_healthy medtech-hr-erp-hr-erp-1
  curl --fail --silent --show-error http://127.0.0.1:8080/healthz >/dev/null
  curl --fail --silent --show-error http://127.0.0.1:8080/api/v1/health >/dev/null
  verify_runtime_database_role
  verify_database_transport
  install_host_network_hardening
  install_edge_config
  install_monitoring
  api_id=$(docker inspect --format '{{.Image}}' medtech-hr-erp-api-1)
  web_id=$(docker inspect --format '{{.Image}}' medtech-hr-erp-hr-erp-1)
  [[ $(docker image inspect "$api_id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') == "$DEPLOYED_COMMIT" ]]
  [[ $(docker image inspect "$web_id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') == "$DEPLOYED_COMMIT" ]]
  printf '%s\n' "$DEPLOYED_COMMIT" >"$project_dir/.deployed-commit"
  printf 'commit=%s\napi=%s\nweb=%s\n' "$DEPLOYED_COMMIT" "$api_id" "$web_id" >"$project_dir/.deployed-images"
  chmod 600 "$project_dir/.deployed-commit" "$project_dir/.deployed-images"
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
  docker run -d --name "$container" --network "$network" --network-alias postgres -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=hr_erp_restore -v "$volume:/var/lib/postgresql/data" postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685 >/dev/null
  for _ in {1..60}; do docker exec "$container" pg_isready -U postgres -d hr_erp_restore >/dev/null 2>&1 && break; sleep 2; done
  docker exec "$container" pg_isready -U postgres -d hr_erp_restore >/dev/null
  docker cp "$dump" "$container:/tmp/hr_erp.dump"
  docker exec "$container" pg_restore -U postgres -d hr_erp_restore --no-owner --no-privileges /tmp/hr_erp.dump
  docker run --rm --network "$network" -e DATABASE_URL="postgresql://postgres:$password@postgres:5432/hr_erp_restore?schema=public" medtech-hr-erp-api:latest npx prisma migrate deploy >/dev/null
  docker run -d --name "$app_container" --network "$network" --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges:true -e NODE_ENV=test -e PORT=3000 -e DATABASE_URL="postgresql://postgres:$password@postgres:5432/hr_erp_restore?schema=public" -e JWT_SECRET="$jwt" -e AUDIT_HMAC_KEY="$audit_key" -e DOCUMENT_SCAN_ENABLED=false medtech-hr-erp-api:latest >/dev/null
  for _ in {1..60}; do docker exec "$app_container" node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && break; sleep 2; done
  docker exec "$app_container" node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  docker exec "$app_container" node scripts/financial-regression.js
  docker exec "$container" psql -U postgres -d hr_erp_restore -v ON_ERROR_STOP=1 -Atc 'SELECT COUNT(*) FROM "_prisma_migrations"; SELECT COUNT(*) FROM "Employee"; SELECT COUNT(*) FROM "AuditEvent";'
  echo 'Isolated restore drill passed.'
  cleanup
  trap - EXIT
}

case ${1:-} in
  preflight) trap cleanup_runtime_env EXIT; load_runtime_env; configure_compose; preflight ;;
  backup) trap cleanup_runtime_env EXIT; load_runtime_env; configure_compose; preflight; backup ;;
  deploy) trap cleanup_runtime_env EXIT; load_runtime_env; configure_compose; deploy ;;
  contain-artifacts) [[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }; contain_local_artifacts ;;
  restore-drill) shift; restore_drill "$@" ;;
  *) echo 'Usage: production.sh preflight|backup|deploy|contain-artifacts|restore-drill DUMP MANIFEST' >&2; exit 2 ;;
esac

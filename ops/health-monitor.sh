#!/usr/bin/env bash
set -euo pipefail

metadata='http://metadata.google.internal/computeMetadata/v1'
header='Metadata-Flavor: Google'
project_dir=${PROJECT_DIR:-/opt/medtech-hr-erp}
project_id=$(curl -fsS -H "$header" "$metadata/project/project-id")
instance_id=$(curl -fsS -H "$header" "$metadata/instance/id")
zone=$(basename "$(curl -fsS -H "$header" "$metadata/instance/zone")")
token=$(curl -fsS -H "$header" "$metadata/instance/service-accounts/default/token" | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
now=$(date -u +%FT%TZ)

api_healthy=0
curl -fsS --max-time 5 http://127.0.0.1:8080/api/v1/health >/dev/null && api_healthy=1
edge_healthy=0
curl -fsS --max-time 5 --resolve hr.med-tech.com:443:127.0.0.1 https://hr.med-tech.com/api/v1/health >/dev/null && edge_healthy=1
database_healthy=0
docker exec medtech-hr-erp-postgres-1 psql -U postgres -d hr_erp -Atc 'SELECT 1' >/dev/null 2>&1 && database_healthy=1
cloudflare_tunnel_active=0
systemctl is-active --quiet medtech-hr-erp-cloudflared.service && cloudflare_tunnel_active=1

container_unhealthy=0
for container in medtech-hr-erp-postgres-1 medtech-hr-erp-api-1 medtech-hr-erp-hr-erp-1 medtech-hr-erp-clamav-1; do
  status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)
  [[ $status == healthy || $status == running ]] || ((container_unhealthy += 1))
done

last_backup=$(systemctl show medtech-hr-erp-backup.service -p ExecMainExitTimestamp --value)
backup_epoch=$(date -d "$last_backup" +%s 2>/dev/null || echo 0)
backup_age=$(( $(date +%s) - backup_epoch ))
(( backup_age >= 0 )) || backup_age=2147483647

scanner_failed=$(docker exec medtech-hr-erp-postgres-1 psql -U postgres -d hr_erp -Atc 'SELECT COUNT(*) FROM "EmployeeDocument" WHERE "scanStatus" = '\''FAILED'\'' AND "deletedAt" IS NULL' 2>/dev/null || echo 0)
[[ $scanner_failed =~ ^[0-9]+$ ]] || scanner_failed=0

sql_count() {
  local query=$1 value
  value=$(docker exec medtech-hr-erp-postgres-1 psql -U postgres -d hr_erp -Atc "$query" 2>/dev/null || echo 0)
  [[ $value =~ ^[0-9]+$ ]] && printf '%s' "$value" || printf '0'
}

auth_failures=$(sql_count 'SELECT COUNT(*) FROM "AuditEvent" WHERE "occurredAtUtc" >= NOW() - INTERVAL '\''5 minutes'\'' AND "action" = '\''LOGIN'\'' AND "outcome" <> '\''SUCCESS'\''')
authorization_denials=$(sql_count 'SELECT COUNT(*) FROM "AuditEvent" WHERE "occurredAtUtc" >= NOW() - INTERVAL '\''5 minutes'\'' AND "outcome" = '\''DENIED'\''')
privilege_changes=$(sql_count 'SELECT COUNT(*) FROM "AuditEvent" WHERE "occurredAtUtc" >= NOW() - INTERVAL '\''5 minutes'\'' AND ("isOverride" OR "resourceType" IN ('\''Role'\'', '\''RolePermission'\'', '\''UserRole'\'', '\''UserPermissionOverride'\'')) AND "action" IN ('\''CREATE'\'', '\''UPDATE'\'', '\''DELETE'\'', '\''OVERRIDE'\'', '\''REVOKE'\'')')
audit_chain_inconsistencies=$(sql_count 'SELECT CASE WHEN s.id IS NULL THEN 1 WHEN s."lastSequence" - s."prunedThroughSequence" <> e.event_count OR (e.event_count > 0 AND (e.first_sequence <> s."prunedThroughSequence" + 1 OR e.last_sequence <> s."lastSequence")) THEN 1 ELSE 0 END FROM (VALUES (1)) singleton(marker) LEFT JOIN "AuditChainState" s ON s.id = '\''default'\'' CROSS JOIN (SELECT COUNT(*) AS event_count, MIN("sequence") AS first_sequence, MAX("sequence") AS last_sequence FROM "AuditEvent") e')

payload=$(mktemp /run/hr-erp-monitor.XXXXXX)
trap 'rm -f "$payload"' EXIT
python3 - "$project_id" "$instance_id" "$zone" "$now" "$project_dir/.env" "$api_healthy" "$edge_healthy" "$database_healthy" "$cloudflare_tunnel_active" "$container_unhealthy" "$backup_age" "$scanner_failed" "$auth_failures" "$authorization_denials" "$privilege_changes" "$audit_chain_inconsistencies" >"$payload" <<'PY'
import datetime, json, sys
project, instance, zone, now = sys.argv[1:5]
env_path = sys.argv[5]
values = {
    "publisher_heartbeat": 1,
    "api_healthy": int(sys.argv[6]),
    "edge_healthy": int(sys.argv[7]),
    "database_healthy": int(sys.argv[8]),
    "cloudflare_tunnel_active": int(sys.argv[9]),
    "container_unhealthy_count": int(sys.argv[10]),
    "backup_age_seconds": int(sys.argv[11]),
    "scanner_failed_documents": int(sys.argv[12]),
    "auth_failures_5m": int(sys.argv[13]),
    "authorization_denials_5m": int(sys.argv[14]),
    "privilege_changes_5m": int(sys.argv[15]),
    "audit_chain_inconsistencies": int(sys.argv[16]),
}

environment = {}
try:
    for raw in open(env_path, encoding="utf-8"):
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        environment[key.strip()] = value.strip().strip('"\'')
except OSError:
    pass

current = datetime.datetime.fromisoformat(now.replace("Z", "+00:00"))
expiry_metrics = {
    "MICROSOFT_CLIENT_SECRET_EXPIRES_AT": "microsoft_sso_secret_expiry_days",
    "MICROSOFT_PROVISIONING_CERT_EXPIRES_AT": "provisioning_certificate_expiry_days",
    "MAIL_GRAPH_CERT_EXPIRES_AT": "mail_certificate_expiry_days",
}
for key, metric in expiry_metrics.items():
    try:
        expiry = datetime.datetime.fromisoformat(environment[key].replace("Z", "+00:00"))
        values[metric] = int((expiry - current).total_seconds() // 86400)
    except (KeyError, ValueError):
        values[metric] = -1
for key in ["POSTGRES_PASSWORD_ROTATED_AT", "DATABASE_APP_PASSWORD_ROTATED_AT", "DATABASE_MIGRATOR_PASSWORD_ROTATED_AT", "JWT_SECRET_ROTATED_AT", "AUDIT_HMAC_KEY_ROTATED_AT"]:
    metric = key.lower().removesuffix("_rotated_at") + "_age_days"
    try:
        rotated = datetime.datetime.fromisoformat(environment[key].replace("Z", "+00:00"))
        values[metric] = int((current - rotated).total_seconds() // 86400)
    except (KeyError, ValueError):
        values[metric] = -1
resource = {"type": "gce_instance", "labels": {"project_id": project, "instance_id": instance, "zone": zone}}
series = [{"metric": {"type": f"custom.googleapis.com/hr_erp/{name}"}, "resource": resource, "points": [{"interval": {"endTime": now}, "value": {"int64Value": str(value)}}]} for name, value in values.items()]
print(json.dumps({"timeSeries": series}))
PY
curl -fsS --output /dev/null --request POST \
  --header "Authorization: Bearer $token" \
  --header 'Content-Type: application/json' \
  --data-binary "@$payload" \
  "https://monitoring.googleapis.com/v3/projects/$project_id/timeSeries"

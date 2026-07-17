#!/usr/bin/env bash
set -euo pipefail

metadata='http://metadata.google.internal/computeMetadata/v1'
header='Metadata-Flavor: Google'
project_id=$(curl -fsS -H "$header" "$metadata/project/project-id")
instance_id=$(curl -fsS -H "$header" "$metadata/instance/id")
zone=$(basename "$(curl -fsS -H "$header" "$metadata/instance/zone")")
token=$(curl -fsS -H "$header" "$metadata/instance/service-accounts/default/token" | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
now=$(date -u +%FT%TZ)

api_healthy=0
curl -fsS --max-time 5 http://127.0.0.1/api/v1/health >/dev/null && api_healthy=1
database_healthy=0
docker exec medtech-hr-erp-postgres-1 pg_isready -U postgres -d hr_erp >/dev/null 2>&1 && database_healthy=1
tunnel_healthy=0
systemctl is-active --quiet medtech-hr-erp-cloudflared.service && tunnel_healthy=1

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

payload=$(mktemp /run/hr-erp-monitor.XXXXXX)
trap 'rm -f "$payload"' EXIT
python3 - "$project_id" "$instance_id" "$zone" "$now" "$api_healthy" "$database_healthy" "$tunnel_healthy" "$container_unhealthy" "$backup_age" "$scanner_failed" >"$payload" <<'PY'
import json, sys
project, instance, zone, now = sys.argv[1:5]
values = {
    "api_healthy": int(sys.argv[5]),
    "database_healthy": int(sys.argv[6]),
    "tunnel_healthy": int(sys.argv[7]),
    "container_unhealthy_count": int(sys.argv[8]),
    "backup_age_seconds": int(sys.argv[9]),
    "scanner_failed_documents": int(sys.argv[10]),
}
resource = {"type": "gce_instance", "labels": {"project_id": project, "instance_id": instance, "zone": zone}}
series = [{"metric": {"type": f"custom.googleapis.com/hr_erp/{name}"}, "resource": resource, "points": [{"interval": {"endTime": now}, "value": {"int64Value": str(value)}}]} for name, value in values.items()]
print(json.dumps({"timeSeries": series}))
PY
curl -fsS --output /dev/null --request POST \
  --header "Authorization: Bearer $token" \
  --header 'Content-Type: application/json' \
  --data-binary "@$payload" \
  "https://monitoring.googleapis.com/v3/projects/$project_id/timeSeries"

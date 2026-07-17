#!/usr/bin/env bash
set -euo pipefail
umask 077

bucket='hr-erp-502412-backups'
project_dir='/opt/medtech-hr-erp'
backup_service_account='hr-erp-backup@hr-erp-502412.iam.gserviceaccount.com'
stamp=$(date -u +%Y%m%dT%H%M%SZ)
hour=$(date -u +%H)
weekday=$(date -u +%u)
day=$(date -u +%d)
work_dir=$(mktemp -d /var/backups/medtech-hr-erp.XXXXXX)
trap 'rm -rf "$work_dir"' EXIT

database_dump="$work_dir/hr_erp.dump"
manifest="$work_dir/manifest.json"

/usr/bin/docker exec medtech-hr-erp-postgres-1 pg_dump -U postgres -d hr_erp --format=custom --no-owner --no-privileges >"$database_dump"
test -s "$database_dump"

database_sha256=$(sha256sum "$database_dump" | awk '{print $1}')
database_bytes=$(stat -c '%s' "$database_dump")
cat >"$manifest" <<EOF
{"createdAt":"$(date -u +%FT%TZ)","databaseSha256":"$database_sha256","databaseBytes":$database_bytes,"documentsStoredInGcs":true}
EOF

access_token=$(gcloud auth print-access-token --impersonate-service-account="$backup_service_account" --quiet)
upload() {
  local destination=$1 file=$2 name=$3 encoded
  encoded=$(/usr/bin/python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$destination/$name")
  curl --fail --silent --show-error --output /dev/null --request POST \
    --header "Authorization: Bearer $access_token" \
    --header 'Content-Type: application/octet-stream' \
    --data-binary "@$file" \
    "https://storage.googleapis.com/upload/storage/v1/b/$bucket/o?uploadType=media&name=$encoded"
}

destinations=("hourly/$stamp")
[[ $hour == 00 ]] && destinations+=("daily/$stamp")
[[ $hour == 00 && $weekday == 7 ]] && destinations+=("weekly/$stamp")
[[ $hour == 00 && $day == 01 ]] && destinations+=("monthly/$stamp")

for destination in "${destinations[@]}"; do
  upload "$destination" "$database_dump" hr_erp.dump
  upload "$destination" "$manifest" manifest.json
  echo "Backup uploaded to gs://$bucket/$destination"
done

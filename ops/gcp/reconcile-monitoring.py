#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import tempfile

project = os.environ.get("GOOGLE_CLOUD_PROJECT", "hr-erp-502412")
resource = 'resource.type="gce_instance"'
apply = sys.argv[1:] == ["--apply"]
if sys.argv[1:] not in ([], ["--check"], ["--apply"]):
    raise SystemExit("Usage: reconcile-monitoring.py [--check|--apply]")
gcloud_executable = os.environ.get("GCLOUD_COMMAND") or shutil.which("gcloud") or shutil.which("gcloud.cmd")
if not gcloud_executable:
    raise SystemExit("gcloud is required")


def threshold(name, metric, comparison, value, duration="0s"):
    return {
        "displayName": name,
        "conditionThreshold": {
            "filter": f'{resource} AND metric.type="custom.googleapis.com/hr_erp/{metric}"',
            "comparison": comparison,
            "thresholdValue": value,
            "duration": duration,
            "trigger": {"count": 1},
        },
    }


def absence(name, metric):
    return {
        "displayName": name,
        "conditionAbsent": {
            "filter": f'{resource} AND metric.type="custom.googleapis.com/hr_erp/{metric}"',
            "duration": "600s",
            "trigger": {"count": 1},
        },
    }


def policy(name, conditions, documentation):
    return {
        "displayName": name,
        "combiner": "OR",
        "enabled": True,
        "conditions": conditions,
        "documentation": {"content": documentation, "mimeType": "text/markdown"},
        "userLabels": {"managed-by": "medtech-repository", "service": "hr-erp"},
    }


desired = [
    policy("HR ERP component health failure", [
        threshold("API health failed", "api_healthy", "COMPARISON_LT", 1),
        threshold("Public edge health failed", "edge_healthy", "COMPARISON_LT", 1),
        threshold("Database health failed", "database_healthy", "COMPARISON_LT", 1),
        threshold("One or more containers unhealthy", "container_unhealthy_count", "COMPARISON_GT", 0),
    ], "Check the application, host Nginx, PostgreSQL TLS, and container health. The obsolete Cloudflare-service condition is intentionally removed."),
    policy("HR ERP health monitor silent", [
        absence("Health publisher stopped", "publisher_heartbeat"),
    ], "The five-minute host publisher has emitted no heartbeat for ten minutes."),
    policy("HR ERP security control signals", [
        threshold("Authentication failure burst", "auth_failures_5m", "COMPARISON_GT", 10),
        threshold("Authorization denial burst", "authorization_denials_5m", "COMPARISON_GT", 20),
        threshold("Privilege or role change", "privilege_changes_5m", "COMPARISON_GT", 0),
        threshold("Audit chain state mismatch", "audit_chain_inconsistencies", "COMPARISON_GT", 0),
    ], "Triage the immutable audit trail, actor/session, affected permission or role, and correlated API/host logs."),
    policy("HR ERP secret rotation metadata missing", [
        threshold("PostgreSQL superuser rotation date missing", "postgres_password_age_days", "COMPARISON_LT", 0),
        threshold("Application database rotation date missing", "database_app_password_age_days", "COMPARISON_LT", 0),
        threshold("Migrator database rotation date missing", "database_migrator_password_age_days", "COMPARISON_LT", 0),
        threshold("JWT rotation date missing", "jwt_secret_age_days", "COMPARISON_LT", 0),
        threshold("Audit HMAC rotation date missing", "audit_hmac_key_age_days", "COMPARISON_LT", 0),
    ], "Set the non-secret ISO-8601 rotation timestamp in `.env` and verify the matching Secret Manager version."),
    policy("HR ERP secret maximum age exceeded", [
        threshold("PostgreSQL superuser older than 180 days", "postgres_password_age_days", "COMPARISON_GT", 180),
        threshold("Application database password older than 90 days", "database_app_password_age_days", "COMPARISON_GT", 90),
        threshold("Migrator database password older than 90 days", "database_migrator_password_age_days", "COMPARISON_GT", 90),
        threshold("JWT signing secret older than 90 days", "jwt_secret_age_days", "COMPARISON_GT", 90),
        threshold("Audit HMAC older than 365 days", "audit_hmac_key_age_days", "COMPARISON_GT", 365),
    ], "Follow `ops/SECRET_ROTATION.md`; preserve rollback and audit-HMAC verification overlap."),
]


def gcloud(*arguments):
    result = subprocess.run(
        [gcloud_executable, *arguments, f"--project={project}", "--quiet"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


current = json.loads(gcloud("monitoring", "policies", "list", "--format=json"))
by_name = {}
for item in current:
    by_name.setdefault(item.get("displayName"), []).append(item)
duplicates = [name for name, items in by_name.items() if name and len(items) > 1]
if duplicates:
    raise SystemExit(f"Duplicate alert policy names require manual reconciliation: {', '.join(sorted(duplicates))}")

channels = next((item.get("notificationChannels") for item in current if item.get("displayName", "").startswith("HR ERP") and item.get("notificationChannels")), None)
if not channels:
    raise SystemExit("No existing HR ERP notification channel is available; refusing to create silent policies")

for item in desired:
    existing = by_name.get(item["displayName"], [])
    item["notificationChannels"] = existing[0].get("notificationChannels") if existing and existing[0].get("notificationChannels") else channels
    if existing:
        item["name"] = existing[0]["name"]
    if not apply:
        continue
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as handle:
        json.dump(item, handle)
        path = handle.name
    try:
        if existing:
            gcloud("monitoring", "policies", "update", existing[0]["name"], f"--policy-from-file={path}")
        else:
            gcloud("monitoring", "policies", "create", f"--policy-from-file={path}")
    finally:
        os.unlink(path)

print(json.dumps({"mode": "apply" if apply else "check", "policies": [item["displayName"] for item in desired]}, indent=2))

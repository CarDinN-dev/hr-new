#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
RUNTIME_DIR="$ROOT/.cloudflare"
LOG_DIR="$ROOT/cloudflare-logs"
URL_FILE="$ROOT/.cloudflare-tunnel-url"
PID_FILE="$RUNTIME_DIR/tunnel.pid"
PROCESS_STATE_FILE="$RUNTIME_DIR/tunnel-process.tsv"
APP_MARKER="$RUNTIME_DIR/app-started"
CONFIG_STATE="$RUNTIME_DIR/config-moves.tsv"
ORIGIN="http://127.0.0.1:8080"
HEALTH_URL="$ORIGIN/healthz"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"
cd "$ROOT"

is_healthy() {
  curl --fail --silent --show-error --max-time 5 "$HEALTH_URL" >/dev/null 2>&1
}

process_signature() {
  if [ -r "/proc/$1/stat" ]; then
    awk '{ print $22 }' "/proc/$1/stat" 2>/dev/null
  else
    ps -p "$1" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
  fi
}

owned_tunnel_pid() {
  [ -f "$PID_FILE" ] && [ -f "$PROCESS_STATE_FILE" ] || return 1
  pid=$(cat "$PID_FILE")
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  tab=$(printf '\t')
  IFS="$tab" read -r state_pid state_signature < "$PROCESS_STATE_FILE" || return 1
  [ "$state_pid" = "$pid" ] || return 1
  command_name=$(ps -p "$pid" -o comm= 2>/dev/null || true)
  case "$command_name" in *cloudflared*) ;; *) return 1 ;; esac
  [ -n "$state_signature" ] && [ "$(process_signature "$pid")" = "$state_signature" ] || return 1
  printf '%s\n' "$pid"
}

restore_config() {
  [ -f "$CONFIG_STATE" ] || return 0
  pending="$CONFIG_STATE.pending"
  : > "$pending"
  tab=$(printf '\t')
  while IFS="$tab" read -r original backup; do
    [ -n "$original" ] && [ -f "$backup" ] || continue
    if [ -e "$original" ]; then
      printf 'Cannot restore %s; backup kept at %s\n' "$original" "$backup" >&2
      printf '%s\t%s\n' "$original" "$backup" >> "$pending"
    else
      mv "$backup" "$original"
    fi
  done < "$CONFIG_STATE"
  if [ -s "$pending" ]; then mv "$pending" "$CONFIG_STATE"; else rm -f "$pending" "$CONFIG_STATE"; fi
}

stop_owned_app() {
  [ -f "$APP_MARKER" ] || return 0
  docker compose stop || true
  rm -f "$APP_MARKER"
}

cleanup_failure() {
  trap - INT TERM HUP EXIT
  if owned_pid=$(owned_tunnel_pid 2>/dev/null); then
    kill "$owned_pid" 2>/dev/null || true
  elif [ -n "${tunnel_pid:-}" ]; then
    kill "$tunnel_pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE" "$PROCESS_STATE_FILE" "$URL_FILE"
  restore_config
  [ "${APP_WAS_RUNNING:-1}" -eq 1 ] || stop_owned_app
}

if [ -f "$PID_FILE" ]; then
  if existing_pid=$(owned_tunnel_pid 2>/dev/null); then
    printf 'Tunnel is already running (PID %s).\n' "$existing_pid" >&2
    exit 1
  fi
  raw_pid=$(cat "$PID_FILE")
  case "$raw_pid" in
    ''|*[!0-9]*) ;;
    *)
      command_name=$(ps -p "$raw_pid" -o comm= 2>/dev/null || true)
      case "$command_name" in
        *cloudflared*) printf 'PID %s belongs to an unverified cloudflared process; it was not touched.\n' "$raw_pid" >&2; exit 1 ;;
      esac
      ;;
  esac
fi
rm -f "$PID_FILE" "$PROCESS_STATE_FILE" "$URL_FILE"
restore_config

command -v curl >/dev/null 2>&1 || { printf 'curl is required.\n' >&2; exit 1; }
command -v cloudflared >/dev/null 2>&1 || { printf 'cloudflared is required.\n' >&2; exit 1; }

APP_WAS_RUNNING=1
if ! is_healthy; then
  APP_WAS_RUNNING=0
  command -v docker >/dev/null 2>&1 || { printf 'Docker is required to start this project.\n' >&2; exit 1; }
  running_services=$(docker compose ps --status running -q 2>/dev/null || true)
  docker compose up -d --build
  [ -n "$running_services" ] || date -u +%FT%TZ > "$APP_MARKER"

  attempt=0
  until is_healthy; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 90 ]; then
      cleanup_failure
      printf 'Application did not become healthy at %s.\n' "$HEALTH_URL" >&2
      exit 1
    fi
    sleep 2
  done
fi

trap cleanup_failure INT TERM HUP EXIT

config_dir="$HOME/.cloudflared"
: > "$CONFIG_STATE"
for name in config.yml config.yaml; do
  original="$config_dir/$name"
  [ -f "$original" ] || continue
  backup="$original.quick-tunnel-disabled-$(date +%Y%m%d%H%M%S)"
  mv "$original" "$backup"
  printf '%s\t%s\n' "$original" "$backup" >> "$CONFIG_STATE"
done
[ -s "$CONFIG_STATE" ] || rm -f "$CONFIG_STATE"

timestamp=$(date +%Y%m%d-%H%M%S)
stdout_log="$LOG_DIR/cloudflared-$timestamp.out.log"
stderr_log="$LOG_DIR/cloudflared-$timestamp.err.log"
cloudflared tunnel --url "$ORIGIN" >"$stdout_log" 2>"$stderr_log" &
tunnel_pid=$!
printf '%s\n' "$tunnel_pid" > "$PID_FILE"

signature=""
attempt=0
while [ -z "$signature" ] && [ "$attempt" -lt 10 ]; do
  signature=$(process_signature "$tunnel_pid")
  attempt=$((attempt + 1))
  [ -n "$signature" ] || sleep 1
done
[ -n "$signature" ] || { printf 'Could not record tunnel process identity.\n' >&2; exit 1; }
printf '%s\t%s\n' "$tunnel_pid" "$signature" > "$PROCESS_STATE_FILE"

public_url=""
attempt=0
while [ -z "$public_url" ]; do
  attempt=$((attempt + 1))
  if ! kill -0 "$tunnel_pid" 2>/dev/null || [ "$attempt" -ge 60 ]; then
    printf 'cloudflared did not produce a Quick Tunnel URL. Review %s.\n' "$stderr_log" >&2
    exit 1
  fi
  public_url=$(grep -Eoh 'https://[a-z0-9-]+\.trycloudflare\.com' "$stdout_log" "$stderr_log" 2>/dev/null | head -n 1 || true)
  [ -n "$public_url" ] || sleep 1
done

printf '%s\n' "$public_url" > "$URL_FILE"
trap - INT TERM HUP EXIT
printf 'Cloudflare Quick Tunnel is ready: %s\nLogs: %s\n' "$public_url" "$LOG_DIR"

#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
RUNTIME_DIR="$ROOT/.cloudflare"
URL_FILE="$ROOT/.cloudflare-tunnel-url"
PID_FILE="$RUNTIME_DIR/tunnel.pid"
PROCESS_STATE_FILE="$RUNTIME_DIR/tunnel-process.tsv"
APP_MARKER="$RUNTIME_DIR/app-started"
CONFIG_STATE="$RUNTIME_DIR/config-moves.tsv"

cd "$ROOT"

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

if tunnel_pid=$(owned_tunnel_pid 2>/dev/null); then
  kill "$tunnel_pid" 2>/dev/null || true
elif [ -f "$PID_FILE" ]; then
  raw_pid=$(cat "$PID_FILE")
  case "$raw_pid" in
    ''|*[!0-9]*) printf 'Removed stale tunnel state.\n' >&2 ;;
    *)
      command_name=$(ps -p "$raw_pid" -o comm= 2>/dev/null || true)
      [ -z "$command_name" ] || printf 'PID %s is not a verified tunnel process; it was not stopped.\n' "$raw_pid" >&2
      ;;
  esac
fi
rm -f "$PID_FILE" "$PROCESS_STATE_FILE" "$URL_FILE"

if [ -f "$CONFIG_STATE" ]; then
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
fi

if [ -f "$APP_MARKER" ]; then
  docker compose stop
  rm -f "$APP_MARKER"
fi

printf 'Cloudflare Quick Tunnel is stopped.\n'

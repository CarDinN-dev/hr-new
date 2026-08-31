#!/usr/bin/env bash
set -euo pipefail

mode=${1:---check}
[[ $mode == --check || $mode == --apply ]] || { echo 'Usage: host-network-hardening.sh [--check|--apply]' >&2; exit 2; }

for command in iptables ip6tables ss; do command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }; done

if [[ $mode == --apply ]]; then
  [[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
  for tool in iptables ip6tables; do
    for port in 20201 20202; do
      "$tool" -w -C INPUT ! -i lo -p tcp --dport "$port" -j DROP 2>/dev/null \
        || "$tool" -w -I INPUT 1 ! -i lo -p tcp --dport "$port" -j DROP
    done
  done
fi

for tool in iptables ip6tables; do
  for port in 20201 20202; do
    "$tool" -w -C INPUT ! -i lo -p tcp --dport "$port" -j DROP >/dev/null
  done
done

if ss -H -lun | awk '$4 ~ /:5355$/ { found=1 } END { exit !found }'; then
  echo 'LLMNR is still listening on UDP 5355.' >&2
  exit 1
fi

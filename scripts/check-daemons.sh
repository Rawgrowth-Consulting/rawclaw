#!/usr/bin/env bash
# Overnight bg-daemon + infra health monitor per [B 04:02 → C] P13.
#
# Usage:
#   bash scripts/check-daemons.sh
#
# Inspects:
#   - Each known background daemon (PID alive or task-id surface)
#   - Marti VPS HTTP uptime
#   - /tmp free space (background tasks write log artefacts here)
#   - Work-board file size (sanity check the WB hasn't ballooned)
#
# Exit code: 0 if every daemon answered. >0 if any daemon was
# unreachable (caller can wire this into a cron alert).
#
# PIDs / task ids are read from /home/pedroafonso/.bg-daemons.list
# if it exists - format: `Name:PID-or-task-id`, one per line.
# Falls back to the seed list below when the file is absent so
# the script still works on a freshly-deployed box.

set -uo pipefail

readonly DAEMON_LIST_FILE="${DAEMON_LIST_FILE:-/home/pedroafonso/.bg-daemons.list}"
readonly WB_PATH="${WB_PATH:-/home/pedroafonso/Downloads/work-board-2026-05-17.html}"
readonly MARTI_URL="${MARTI_URL:-https://marti.rawgrowth.ai}"

# Seed list - shape `Name:PID-or-task-id`. Numeric = OS PID,
# alphanumeric = harness task id (Monitor / Bash run_in_background).
readonly DEFAULT_DAEMONS=(
  "Monitor:task-id-only"
  "wake-ping:0"
  "CI-WATCHER:0"
  "WB-state-summary:0"
  "REFLEX-DAEMON:0"
  "RETRY-DAEMON:0"
)

load_daemons() {
  if [[ -f "$DAEMON_LIST_FILE" ]]; then
    mapfile -t DAEMONS < "$DAEMON_LIST_FILE"
  else
    DAEMONS=("${DEFAULT_DAEMONS[@]}")
  fi
}

check_pid_alive() {
  local pid="$1"
  if kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  return 1
}

check_daemons() {
  local failed=0
  echo "=== Background daemons ==="
  for entry in "${DAEMONS[@]}"; do
    [[ -z "$entry" || "$entry" =~ ^# ]] && continue
    local name="${entry%%:*}"
    local id="${entry##*:}"

    if [[ "$id" =~ ^[0-9]+$ ]] && [[ "$id" -gt 0 ]]; then
      if check_pid_alive "$id"; then
        echo "  ✓ $name (PID $id) alive"
      else
        echo "  ✗ $name (PID $id) DEAD"
        failed=$((failed + 1))
      fi
    elif [[ "$id" == "0" || "$id" == "task-id-only" ]]; then
      echo "  ? $name (no PID registered) - check via harness TaskList"
    else
      # Looks like a harness task id (alphanum).
      echo "  ? $name (task $id) - check via harness TaskList"
    fi
  done
  return "$failed"
}

check_marti() {
  echo "=== Marti uptime ==="
  local status
  status=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "$MARTI_URL" || echo "TIMEOUT")
  if [[ "$status" =~ ^(200|301|302|307|308)$ ]]; then
    echo "  ✓ $MARTI_URL → HTTP $status"
    return 0
  fi
  echo "  ✗ $MARTI_URL → $status"
  return 1
}

check_disk() {
  echo "=== /tmp disk space ==="
  df -h /tmp | tail -1 | awk '{
    used = $5; sub(/%/, "", used)
    if (used + 0 > 90) {
      print "  ✗ /tmp at " $5 " (threshold 90%)"
      exit 1
    }
    print "  ✓ /tmp at " $5 " - " $4 " free"
  }'
}

check_wb() {
  echo "=== Work-board file ==="
  if [[ ! -f "$WB_PATH" ]]; then
    echo "  ✗ work-board not found at $WB_PATH"
    return 1
  fi
  local size_bytes
  size_bytes=$(stat -c%s "$WB_PATH" 2>/dev/null || stat -f%z "$WB_PATH" 2>/dev/null || echo 0)
  local size_mb=$((size_bytes / 1024 / 1024))
  if (( size_mb > 50 )); then
    echo "  ⚠ work-board is ${size_mb}MB - rotation recommended"
  else
    echo "  ✓ work-board $(ls -lh "$WB_PATH" | awk '{print $5}')"
  fi
}

main() {
  load_daemons
  local rc=0
  check_daemons || rc=$((rc + $?))
  check_marti || rc=$((rc + 1))
  check_disk || rc=$((rc + 1))
  check_wb || rc=$((rc + 1))
  echo "==="
  if (( rc == 0 )); then
    echo "OK - all checks passed"
  else
    echo "FAIL - $rc check(s) reported a problem"
  fi
  return "$rc"
}

main "$@"

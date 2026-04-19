#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# Rawgrowth — push an update to one client VPS.
# Pulls latest main, rebuilds the container, runs migrations on boot.
#
# Usage:
#   ./update-vps.sh --host 1.2.3.4 [--ssh-user root] [--branch main]
# ─────────────────────────────────────────────────────────────

HOST=""
SSH_USER="root"
BRANCH="main"
TARGET="/opt/rawgrowth"

while [ $# -gt 0 ]; do
  case "$1" in
    --host)     HOST="$2"; shift 2 ;;
    --ssh-user) SSH_USER="$2"; shift 2 ;;
    --branch)   BRANCH="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [ -z "$HOST" ]; then
  echo "Usage: $0 --host <ip> [--ssh-user root] [--branch main]"
  exit 1
fi

SSH="ssh -o StrictHostKeyChecking=accept-new ${SSH_USER}@${HOST}"

echo "▸ Updating ${HOST} (branch: ${BRANCH})"
$SSH "cd ${TARGET} \
  && git fetch origin \
  && git checkout ${BRANCH} \
  && git pull --rebase --autostash \
  && docker compose up --build -d \
  && sleep 6 \
  && curl -fsS http://localhost/api/health | head -c 200 \
  && echo"
echo
echo "✓ Update applied. Tail logs with:"
echo "  ssh ${SSH_USER}@${HOST} 'cd ${TARGET} && docker compose logs -f app'"

#!/bin/bash
# Pull-only deploy. Replaces `docker compose up -d --build` which
# OOM-killed the 4GB CX22 every time. Runs on the VPS, expects:
#
#   - the repo checked out somewhere with docker-compose.yml + .env inside
#   - branch v3 checked out
#   - GHCR_PULL_TOKEN env var (read-only PAT for ghcr.io) OR public image
#
# Triggered from your laptop:
#   ssh root@<vps-ip> 'bash /opt/rawgrowth/scripts/deploy-vps.sh'
#
# On legacy boxes (e.g. Marti at /opt/rawclaw), the same script works
# because of the path-resolver below.
#
# Path resolution priority:
#   1. RAWGROWTH_HOME env var if set (explicit override)
#   2. parent dir of this script if it sits inside <repo>/scripts/
#      and that dir contains both docker-compose.yml and .env
#   3. fallback /opt/rawgrowth (historical default)

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PARENT_DIR="$( cd "${SCRIPT_DIR}/.." 2>/dev/null && pwd || echo "" )"

if [ -n "${RAWGROWTH_HOME:-}" ]; then
  TARGET="${RAWGROWTH_HOME}"
elif [ -n "${PARENT_DIR}" ] && [ -f "${PARENT_DIR}/docker-compose.yml" ] && [ -f "${PARENT_DIR}/.env" ]; then
  TARGET="${PARENT_DIR}"
elif [ -d /opt/rawgrowth ]; then
  TARGET=/opt/rawgrowth
else
  echo "[deploy] cannot find repo root. Set RAWGROWTH_HOME, run from inside <repo>/scripts/, or ensure /opt/rawgrowth exists." >&2
  exit 1
fi

echo "[deploy] working dir: ${TARGET}"
cd "${TARGET}"

# Compose file selection. v3 boxes (e.g. Marti at /opt/rawclaw) MUST use
# docker-compose.v3.yml: it bind-mounts the Claude OAuth credential to
# /home/nextjs/.claude/.credentials.json (where the runner-stage app user
# reads it). The default docker-compose.yml mounts to /home/node, so a
# deploy through it leaves the agent with "Not logged in" while the web
# app still serves - the exact login break seen on 2026-05-20. Prefer the
# v3 compose when present; override with DEPLOY_COMPOSE_FILE.
if [ -n "${DEPLOY_COMPOSE_FILE:-}" ]; then
  COMPOSE_FILE="${DEPLOY_COMPOSE_FILE}"
elif [ -f "${TARGET}/docker-compose.v3.yml" ]; then
  COMPOSE_FILE="docker-compose.v3.yml"
else
  COMPOSE_FILE="docker-compose.yml"
fi
echo "[deploy] compose file: ${COMPOSE_FILE}"
dc() { docker compose -f "${COMPOSE_FILE}" "$@"; }

echo "[deploy] git pull origin v3"
git pull origin v3

echo "[deploy] login to ghcr.io"
if [ -n "${GHCR_PULL_TOKEN:-}" ]; then
  echo "$GHCR_PULL_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-pedroafonso-rawclaw}" --password-stdin
else
  # Public image works without auth. If our package is private, this
  # warning is the symptom you'll see on `docker pull`.
  echo "[deploy] no GHCR_PULL_TOKEN, attempting unauthenticated pull"
fi

echo "[deploy] docker compose pull (pulls latest v3 image from GHCR)"
dc pull app

echo "[deploy] docker compose up -d (no rebuild, just swap container)"
dc up -d app

echo "[deploy] tailing app logs for 30s, watching for 'Ready'"
timeout 30 dc logs -f app | grep -m1 "Ready in" || true

# Sanity-check the swap actually landed the new image, since a silent
# stale-image deploy is the failure mode this script exists to prevent.
echo "[deploy] running image:"
dc images app || true

echo "[deploy] done. health check:"
sleep 2
# The app listens on the compose network, not host :3000 (Caddy fronts
# TLS). Probe inside the container so the check reflects the app, not a
# host port that is never published.
dc exec -T app sh -lc 'curl -sS -o /dev/null -w "  /api/health %{http_code}\n" http://127.0.0.1:3000/api/health' \
  || echo "  /api/health check skipped (no curl in container) - see 'Ready in' above"

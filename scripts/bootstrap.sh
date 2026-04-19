#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# Rawgrowth AIOS — self-hosted bootstrap
#
# Run this from a fresh checkout to:
#   1. Verify Docker is installed and running
#   2. Generate POSTGRES_PASSWORD, JWT_SECRET, NEXTAUTH_SECRET (if missing)
#   3. Write .env from .env.self-hosted.example (if missing)
#   4. Boot the stack via docker compose
#
# Re-running is safe: existing .env values are preserved.
# Requires: docker, docker compose, openssl. Does NOT require Node locally.
# ─────────────────────────────────────────────────────────────

cd "$(dirname "$0")/.."

bold()  { printf "\033[1m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }

bold "▸ Rawgrowth self-hosted bootstrap"
echo

# ─── 1. Preflight ────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  red "✗ Docker is not installed. Get it at https://docs.docker.com/get-docker/"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  red "✗ Docker daemon isn't running. Start Docker Desktop and re-run."
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  red "✗ openssl is required (it ships with macOS and most Linux distros)."
  exit 1
fi
green "✓ Docker + openssl detected"
echo

# ─── 2. Create .env if missing ───────────────────────────────
if [ ! -f .env ]; then
  cp .env.self-hosted.example .env
  yellow "→ Created .env from .env.self-hosted.example"
else
  yellow "→ .env already exists — preserving any values you've set"
fi

# ─── 3. Generate any missing secrets in-place ────────────────
generate_if_missing() {
  local key="$1"
  local current
  current="$(grep -E "^${key}=" .env | head -1 | cut -d= -f2- || true)"
  # Treat the placeholder strings from the example as missing
  if [ -z "$current" ] \
    || [[ "$current" =~ ^change-me ]] \
    || [[ "$current" =~ ^replace-with ]] \
    || [[ "$current" =~ ^another-long ]] \
    || [[ "$current" =~ ^paste-the-output ]]; then
    local generated
    generated="$(openssl rand -hex 32)"
    # Portable in-place sed for both BSD (mac) and GNU (linux)
    if sed --version >/dev/null 2>&1; then
      sed -i "s|^${key}=.*|${key}=${generated}|" .env
    else
      sed -i '' "s|^${key}=.*|${key}=${generated}|" .env
    fi
    green "✓ Generated ${key}"
  else
    yellow "→ ${key} already set — keeping it"
  fi
}

generate_if_missing POSTGRES_PASSWORD
generate_if_missing JWT_SECRET
generate_if_missing NEXTAUTH_SECRET

# Clear the placeholder service-role JWT — the container mints its own from JWT_SECRET on boot.
if sed --version >/dev/null 2>&1; then
  sed -i "s|^SUPABASE_SERVICE_ROLE_KEY=paste.*|SUPABASE_SERVICE_ROLE_KEY=|" .env
else
  sed -i '' "s|^SUPABASE_SERVICE_ROLE_KEY=paste.*|SUPABASE_SERVICE_ROLE_KEY=|" .env
fi

# Clear the placeholder admin password so the seed generates and prints one.
if sed --version >/dev/null 2>&1; then
  sed -i "s|^SEED_ADMIN_PASSWORD=change-me.*|SEED_ADMIN_PASSWORD=|" .env
else
  sed -i '' "s|^SEED_ADMIN_PASSWORD=change-me.*|SEED_ADMIN_PASSWORD=|" .env
fi

echo
bold "▸ Booting docker compose"
echo "  (first build downloads Postgres + PostgREST + Caddy and bundles Next.js — takes ~2 min)"
echo
docker compose up --build -d

echo
green "✓ Stack is starting in the background"
echo
bold "▸ Tailing app logs — watch for the credentials banner"
echo "  (press Ctrl+C once you see it; the stack keeps running)"
echo
sleep 2
docker compose logs -f app

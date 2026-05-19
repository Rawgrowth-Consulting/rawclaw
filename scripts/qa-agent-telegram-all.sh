#!/bin/bash
# QA roundtrip for ALL per-agent Telegram bots on a VPS. Pulls every
# connected bot row from rgaios_agent_telegram_bots via Supabase REST,
# decrypts each bot_token with JWT_SECRET, then invokes
# qa-agent-telegram-roundtrip.sh against each one in turn. Prints a
# summary table and exits 0 only if every bot passed.
#
# Why this exists: qa-agent-telegram-roundtrip.sh tests ONE bot at a
# time. The brief §9.4 SLA is per-bot, so a VPS with three department
# heads needs three passes. This wrapper fans out so the operator can
# verify the whole fleet with a single command.
#
# Usage:
#   QA_TEST_CHAT_ID=<your chat id> \
#   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... JWT_SECRET=... \
#     ./scripts/qa-agent-telegram-all.sh
#
# Or load env from /opt/rawclaw/.env on a provisioned VPS:
#   QA_TEST_CHAT_ID=<your chat id> \
#     ./scripts/qa-agent-telegram-all.sh --env /opt/rawclaw/.env
#
# Required env (after --env loads if used):
#   SUPABASE_URL                  Supabase project base URL
#   SUPABASE_SERVICE_ROLE_KEY     Service-role key (bypasses RLS)
#   JWT_SECRET                    Same secret the app uses for AES-GCM
#   QA_TEST_CHAT_ID               Telegram chat id to receive every ping
#
# Optional env:
#   ORGANIZATION_ID               Restrict to a single org's bots
#   TIMEOUT_SECS                  Forwarded to the inner roundtrip
#   POLL_INTERVAL                 Forwarded to the inner roundtrip
#
# Exit codes:
#   0   every bot passed
#   N   N bots failed (N >= 1)
#   2   bad usage / missing env / table empty

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INNER="${SCRIPT_DIR}/qa-agent-telegram-roundtrip.sh"

usage() {
  cat <<'USAGE'
qa-agent-telegram-all.sh - QA every per-agent Telegram bot in one shot

Usage:
  qa-agent-telegram-all.sh [--env <path>]

Required env:
  SUPABASE_URL                Supabase project base URL
  SUPABASE_SERVICE_ROLE_KEY   Service-role key
  JWT_SECRET                  Matches the running app's JWT_SECRET
  QA_TEST_CHAT_ID             Telegram chat id Pedro/operator owns

Optional env:
  ORGANIZATION_ID             Restrict to one org's bots
  TIMEOUT_SECS                Forwarded to the inner roundtrip
  POLL_INTERVAL               Forwarded to the inner roundtrip

Exits 0 if every bot passes, otherwise the count of failures.
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "${1:-}" = "--env" ]; then
  if [ -z "${2:-}" ] || [ ! -f "${2}" ]; then
    echo "[qa-all] --env requires a readable file path" >&2
    exit 2
  fi
  # shellcheck disable=SC1090
  set -a; . "${2}"; set +a
  shift 2
fi

: "${SUPABASE_URL:?SUPABASE_URL required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY required}"
: "${JWT_SECRET:?JWT_SECRET required}"
: "${QA_TEST_CHAT_ID:?QA_TEST_CHAT_ID required}"

if [ ! -x "${INNER}" ]; then
  echo "[qa-all] inner script not executable: ${INNER}" >&2
  exit 2
fi

for bin in curl jq node; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "[qa-all] FAIL ${bin} not installed" >&2
    exit 2
  fi
done

# ─── Pull bots from Supabase REST ─────────────────────────────────
# Join rgaios_agent_telegram_bots → rgaios_agents to grab a human name.
# PostgREST embeds via the FK on agent_id. Filter on status='connected'
# (the table has no is_active column; status is the equivalent flag).
REST_URL="${SUPABASE_URL%/}/rest/v1/rgaios_agent_telegram_bots"
SELECT_COLS="id,agent_id,bot_token,bot_username,status,rgaios_agents(name,title,department)"
QUERY="select=${SELECT_COLS}&status=eq.connected&bot_token=not.is.null"
if [ -n "${ORGANIZATION_ID:-}" ]; then
  QUERY="${QUERY}&organization_id=eq.${ORGANIZATION_ID}"
fi

echo "[qa-all] fetching bots from ${REST_URL}"
BOTS_JSON="$(curl -sS --fail-with-body \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Accept: application/json" \
  "${REST_URL}?${QUERY}" 2>&1)" || {
  echo "[qa-all] FAIL Supabase REST call errored: ${BOTS_JSON}" >&2
  exit 2
}

COUNT="$(printf '%s' "$BOTS_JSON" | jq 'length')"
if [ -z "$COUNT" ] || [ "$COUNT" = "0" ]; then
  echo "[qa-all] no bots returned (status=connected, bot_token not null)" >&2
  exit 2
fi
echo "[qa-all] found ${COUNT} bot(s)"

# ─── Inline node decrypt (mirrors src/lib/crypto.ts decryptSecret) ──
# Reads ciphertext on stdin, writes plaintext on stdout. Uses
# JWT_SECRET from the environment. Plaintext (no enc:v1: prefix)
# passes through unchanged, matching the legacy grace in crypto.ts.
decrypt_token() {
  JWT_SECRET="$JWT_SECRET" node -e '
    const { createDecipheriv, createHash } = require("node:crypto");
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { value += c; });
    process.stdin.on("end", () => {
      value = value.trim();
      const PREFIX = "enc:v1:";
      if (!value.startsWith(PREFIX)) { process.stdout.write(value); return; }
      const blob = Buffer.from(value.slice(PREFIX.length), "base64url");
      const iv = blob.subarray(0, 12);
      const tag = blob.subarray(12, 28);
      const ct = blob.subarray(28);
      const key = createHash("sha256")
        .update(`rawgrowth:secret-at-rest:v1:${process.env.JWT_SECRET}`)
        .digest();
      const d = createDecipheriv("aes-256-gcm", key, iv);
      d.setAuthTag(tag);
      process.stdout.write(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
    });
  '
}

# ─── Iterate, run inner script, capture verdict ───────────────────
RESULTS_FILE="$(mktemp)"
trap 'rm -f "$RESULTS_FILE"' EXIT

FAILS=0
INDEX=0
while IFS= read -r row; do
  INDEX=$((INDEX + 1))
  AGENT_NAME="$(printf '%s' "$row" | jq -r '.rgaios_agents.name // .bot_username // .agent_id')"
  ENC_TOKEN="$(printf '%s' "$row" | jq -r '.bot_token')"
  if [ -z "$ENC_TOKEN" ] || [ "$ENC_TOKEN" = "null" ]; then
    echo "[qa-all] (${INDEX}/${COUNT}) ${AGENT_NAME} SKIP empty bot_token"
    printf '%s\t%s\t%s\t%s\n' "$AGENT_NAME" "(empty)" "FAIL" "empty bot_token" >> "$RESULTS_FILE"
    FAILS=$((FAILS + 1))
    continue
  fi

  PLAIN_TOKEN="$(printf '%s' "$ENC_TOKEN" | decrypt_token 2>/dev/null || true)"
  if [ -z "$PLAIN_TOKEN" ]; then
    echo "[qa-all] (${INDEX}/${COUNT}) ${AGENT_NAME} FAIL decrypt"
    printf '%s\t%s\t%s\t%s\n' "$AGENT_NAME" "${ENC_TOKEN:0:10}..." "FAIL" "decrypt failed" >> "$RESULTS_FILE"
    FAILS=$((FAILS + 1))
    continue
  fi

  TOKEN_PREFIX="${PLAIN_TOKEN:0:10}..."
  echo "[qa-all] (${INDEX}/${COUNT}) ${AGENT_NAME} token=${TOKEN_PREFIX}"

  OUT_FILE="$(mktemp)"
  if "${INNER}" "${PLAIN_TOKEN}" "${QA_TEST_CHAT_ID}" "${AGENT_NAME}" \
       >"${OUT_FILE}" 2>&1; then
    VERDICT="PASS"
  else
    VERDICT="FAIL"
    FAILS=$((FAILS + 1))
  fi
  # Inner script prints PASS/FAIL on a tail line; surface its first line
  # (which carries the most operator-relevant context).
  FIRST_LINE="$(head -n 1 "$OUT_FILE" | tr -d '\r' | cut -c1-100)"
  SUMMARY_LINE="$(grep -E '^\[qa\] (PASS|FAIL)' "$OUT_FILE" | tail -n 1 | cut -c1-100)"
  SNIPPET="${SUMMARY_LINE:-$FIRST_LINE}"
  rm -f "$OUT_FILE"

  printf '%s\t%s\t%s\t%s\n' "$AGENT_NAME" "$TOKEN_PREFIX" "$VERDICT" "$SNIPPET" \
    >> "$RESULTS_FILE"
done < <(printf '%s' "$BOTS_JSON" | jq -c '.[]')

# ─── Summary table ────────────────────────────────────────────────
echo
echo "[qa-all] ──── summary ────"
printf '%-30s  %-14s  %-6s  %s\n' "agent_name" "token_prefix" "result" "reply_snippet"
printf '%-30s  %-14s  %-6s  %s\n' "------------------------------" "--------------" "------" "------------------------------"
while IFS=$'\t' read -r name prefix verdict snippet; do
  printf '%-30s  %-14s  %-6s  %s\n' \
    "${name:0:30}" "${prefix:0:14}" "$verdict" "${snippet:0:60}"
done < "$RESULTS_FILE"

echo
if [ "$FAILS" -eq 0 ]; then
  echo "[qa-all] PASS all ${COUNT} bot(s) replied"
  exit 0
fi
echo "[qa-all] FAIL ${FAILS}/${COUNT} bot(s) did not pass"
exit "$FAILS"

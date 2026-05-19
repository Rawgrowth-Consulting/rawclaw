#!/bin/bash
# QA roundtrip for a per-agent Telegram bot. Sends a ping via sendMessage
# and polls getUpdates for a reply from the bot itself in the same chat.
# Verdict on stdout: PASS (with first 100 chars of reply) or FAIL.
#
# Usage:
#   ./scripts/qa-agent-telegram-roundtrip.sh <BOT_TOKEN> <CHAT_ID> [EXPECTED_AGENT_NAME]
#   or via env:
#     BOT_TOKEN=... CHAT_ID=... [EXPECTED_AGENT_NAME=...] \
#       ./scripts/qa-agent-telegram-roundtrip.sh
#
# Notes:
#   - getUpdates only returns updates while no webhook is configured. If
#     the bot has a webhook set (production), this script will FAIL
#     since updates route to the webhook, not long-poll.
#   - EXPECTED_AGENT_NAME is an optional substring matched against the
#     reply text or sender first_name; missing match flips verdict to
#     FAIL even if a reply was received.

set -euo pipefail

usage() {
  cat <<'USAGE'
qa-agent-telegram-roundtrip.sh - ping a Telegram bot and verify it replies

Usage:
  qa-agent-telegram-roundtrip.sh <BOT_TOKEN> <CHAT_ID> [EXPECTED_AGENT_NAME]
  BOT_TOKEN=... CHAT_ID=... [EXPECTED_AGENT_NAME=...] qa-agent-telegram-roundtrip.sh

Args:
  BOT_TOKEN              Telegram bot HTTP token (123456:ABC...)
  CHAT_ID                Numeric chat id to send the ping into
  EXPECTED_AGENT_NAME    Optional substring required in the reply text or
                         sender first_name

Exits 0 on PASS, 1 on FAIL.
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

BOT_TOKEN="${1:-${BOT_TOKEN:-}}"
CHAT_ID="${2:-${CHAT_ID:-}}"
EXPECTED_AGENT_NAME="${3:-${EXPECTED_AGENT_NAME:-}}"

if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
  usage
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "[qa] FAIL jq not installed (apt-get install -y jq)"
  exit 1
fi

API="https://api.telegram.org/bot${BOT_TOKEN}"
TIMEOUT_SECS="${TIMEOUT_SECS:-90}"
POLL_INTERVAL="${POLL_INTERVAL:-5}"
PING_TEXT="QA roundtrip ping $(date +%H:%M:%S)"

echo "[qa] sending ping to chat=${CHAT_ID}"
SEND_RESP="$(curl -sS --fail-with-body \
  -X POST "${API}/sendMessage" \
  --data-urlencode "chat_id=${CHAT_ID}" \
  --data-urlencode "text=${PING_TEXT}" 2>&1)" || {
  echo "[qa] FAIL sendMessage call errored: ${SEND_RESP}"
  exit 1
}

SEND_OK="$(printf '%s' "$SEND_RESP" | jq -r '.ok // false')"
if [ "$SEND_OK" != "true" ]; then
  echo "[qa] FAIL sendMessage rejected: ${SEND_RESP}"
  exit 1
fi

SENT_ID="$(printf '%s' "$SEND_RESP" | jq -r '.result.message_id')"
if [ -z "$SENT_ID" ] || [ "$SENT_ID" = "null" ]; then
  echo "[qa] FAIL sendMessage returned no message_id"
  exit 1
fi
echo "[qa] sent message_id=${SENT_ID}, polling getUpdates for up to ${TIMEOUT_SECS}s"

DEADLINE=$(( $(date +%s) + TIMEOUT_SECS ))
LAST_UPDATE_ID=0
REPLY_TEXT=""
REPLY_FROM=""

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  UPDATES_RESP="$(curl -sS --fail-with-body \
    "${API}/getUpdates?offset=$((LAST_UPDATE_ID + 1))&timeout=0" 2>&1)" || {
    echo "[qa] getUpdates errored, retrying: ${UPDATES_RESP}"
    sleep "$POLL_INTERVAL"
    continue
  }

  UPDATES_OK="$(printf '%s' "$UPDATES_RESP" | jq -r '.ok // false')"
  if [ "$UPDATES_OK" != "true" ]; then
    DESC="$(printf '%s' "$UPDATES_RESP" | jq -r '.description // "unknown"')"
    echo "[qa] FAIL getUpdates rejected: ${DESC}"
    echo "[qa] (if a webhook is set, delete it or test against a webhookless bot)"
    exit 1
  fi

  # Track highest update_id seen so subsequent polls advance the offset.
  MAX_UPD="$(printf '%s' "$UPDATES_RESP" | jq -r '[.result[]?.update_id] | max // 0')"
  if [ -n "$MAX_UPD" ] && [ "$MAX_UPD" != "null" ] && [ "$MAX_UPD" -gt "$LAST_UPDATE_ID" ]; then
    LAST_UPDATE_ID="$MAX_UPD"
  fi

  # Look for a reply from the bot itself in this chat, newer than our sent id.
  MATCH_JSON="$(printf '%s' "$UPDATES_RESP" | jq -c \
    --argjson chat "$CHAT_ID" \
    --argjson sent "$SENT_ID" \
    '[.result[]?.message
       | select(. != null)
       | select(.chat.id == $chat)
       | select(.from.is_bot == true)
       | select(.message_id > $sent)] | first // empty')"

  if [ -n "$MATCH_JSON" ] && [ "$MATCH_JSON" != "null" ]; then
    REPLY_TEXT="$(printf '%s' "$MATCH_JSON" | jq -r '.text // .caption // ""')"
    REPLY_FROM="$(printf '%s' "$MATCH_JSON" | jq -r '.from.first_name // .from.username // ""')"
    break
  fi

  sleep "$POLL_INTERVAL"
done

if [ -z "$REPLY_TEXT" ] && [ -z "$REPLY_FROM" ]; then
  echo "[qa] FAIL no bot reply observed within ${TIMEOUT_SECS}s"
  exit 1
fi

SNIPPET="${REPLY_TEXT:0:100}"

if [ -n "$EXPECTED_AGENT_NAME" ]; then
  if ! printf '%s\n%s' "$REPLY_TEXT" "$REPLY_FROM" | grep -qiF "$EXPECTED_AGENT_NAME"; then
    echo "[qa] FAIL reply received but expected name '${EXPECTED_AGENT_NAME}' not found"
    echo "[qa]      from=${REPLY_FROM} text=${SNIPPET}"
    exit 1
  fi
fi

echo "[qa] PASS reply from='${REPLY_FROM}' text='${SNIPPET}'"
exit 0

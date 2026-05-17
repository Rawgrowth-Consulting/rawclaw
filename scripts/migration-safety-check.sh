#!/bin/bash
# Pre-merge gate: scan migrations/*.sql for destructive operations
# and flag for explicit Pedro approval before merge.
#
# Per [B 04:19 → C] P17. Comment-aware (skips `-- ...` SQL lines) +
# word-boundaried (so the English word "truncated" in a comment
# doesn't match the TRUNCATE op). Baseline allowlist at
# scripts/migration-safety-baseline.txt records legacy approved
# patterns so we don't trip CI on already-shipped migrations.

set -e

MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase/migrations}"
BASELINE_FILE="${BASELINE_FILE:-scripts/migration-safety-baseline.txt}"

# Pattern list. Each entry is an ERE matched after stripping SQL
# comments. Patterns are anchored with \b where the op is a single
# SQL keyword to avoid catching English words in identifiers.
DESTRUCTIVE_PATTERNS=(
  "\bDROP[[:space:]]+TABLE\b"
  "\bDROP[[:space:]]+COLUMN\b"
  "\bDROP[[:space:]]+SCHEMA\b"
  "\bDROP[[:space:]]+DATABASE\b"
  "\bDELETE[[:space:]]+FROM\b"
  "\bTRUNCATE\b"
  "\bALTER[[:space:]]+COLUMN[[:space:]]+[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]+TYPE\b"
  "\bREVOKE\b"
  "\bDISABLE[[:space:]]+ROW[[:space:]]+LEVEL[[:space:]]+SECURITY\b"
)

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: migrations dir not found at $MIGRATIONS_DIR" >&2
  exit 2
fi

# Build baseline lookup. Each baseline line is `<filename>:<pattern>`
# where filename is basename only (e.g. 0075_shared_memory_dedup_index.sql).
declare -A BASELINE
if [ -f "$BASELINE_FILE" ]; then
  while IFS= read -r line; do
    line="${line%%#*}"
    line="$(echo "$line" | tr -d '[:space:]')"
    [ -z "$line" ] && continue
    BASELINE["$line"]=1
  done < "$BASELINE_FILE"
fi

FLAGGED=0
BASELINED=0
FLAGGED_DETAILS=()

shopt -s nullglob
for sql in "$MIGRATIONS_DIR"/*.sql; do
  base="$(basename "$sql")"
  # Strip comments: remove everything from `--` to end of line.
  stripped="$(sed -E 's/--.*$//' "$sql")"
  for pattern in "${DESTRUCTIVE_PATTERNS[@]}"; do
    if echo "$stripped" | grep -iqE "$pattern"; then
      key="${base}:${pattern}"
      key_compact="$(echo "$key" | tr -d '[:space:]')"
      if [ -n "${BASELINE[$key_compact]:-}" ]; then
        BASELINED=$((BASELINED + 1))
      else
        FLAGGED=$((FLAGGED + 1))
        FLAGGED_DETAILS+=("$base contains '$pattern'")
      fi
    fi
  done
done

echo "Scanned $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | wc -l) migration file(s)."
echo "Baseline-approved hits: $BASELINED"

if [ "$FLAGGED" -gt 0 ]; then
  echo ""
  echo "BLOCK: $FLAGGED new destructive pattern(s) found:"
  for detail in "${FLAGGED_DETAILS[@]}"; do
    echo "  - $detail"
  done
  echo ""
  echo "Action required:"
  echo "  1. If the pattern is intentional and reviewed, add the line"
  echo "     '<filename>:<pattern>' to $BASELINE_FILE with a comment"
  echo "     explaining why."
  echo "  2. Get explicit Pedro approval on the PR before merge."
  exit 2
fi

echo "OK: no new destructive patterns."
exit 0

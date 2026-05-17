#!/usr/bin/env bash
# Work-board curation per [B 04:07 → C] P14.
#
# WB grew massive over the overnight session. This script slices
# the noise and prints a Markdown summary so Pedro can read the
# night in one screen instead of scrolling 6000+ lines.
#
# Output:
#   bash scripts/wb-curate.sh > /tmp/wb-summary.md
#
# Sections (in order):
#   1. Merged PRs (git log on origin/v3 since 8h ago)
#   2. Open C PRs (gh pr list, filter by C-authored prefixes)
#   3. R-MARTI-CANONICAL walk verdicts (PASS / FAIL / score)
#   4. C dispatch + completion counters
#   5. Background-daemon health (delegates to check-daemons.sh)
#
# Lane fence: scripts/ only. No src/ touch. Pure ops aid.

set -uo pipefail

readonly WB="${WB:-/home/pedroafonso/Downloads/work-board-2026-05-17.html}"
readonly REPO="${REPO:-/home/pedroafonso/rawclaw-research/rawclaw}"
readonly SINCE="${SINCE:-8 hours ago}"

emit_header() {
  echo "# Work-board curated summary"
  echo ""
  echo "_Generated at $(date '+%Y-%m-%d %H:%M %Z') from \`$WB\`._"
  echo ""
}

emit_merged_prs() {
  echo "## Merged PRs (last $SINCE)"
  echo ""
  if [[ -d "$REPO" ]]; then
    git -C "$REPO" log --oneline origin/v3 --since="$SINCE" 2>/dev/null \
      | grep -E '\(#[0-9]+\)' \
      | sed 's/^/- /' \
      || echo "_no merged PRs in window_"
  else
    echo "_repo not at $REPO_"
  fi
  echo ""
}

emit_open_prs() {
  echo "## Open PRs"
  echo ""
  if command -v gh >/dev/null 2>&1; then
    gh pr list --state open --limit 50 --json number,title,headRefName 2>/dev/null \
      | python3 -c '
import json, sys
rows = json.load(sys.stdin)
if not rows:
    print("_no open PRs_")
else:
    for r in rows:
        num = r["number"]
        branch = r["headRefName"]
        title = r["title"]
        print(f"- #{num} `{branch}` - {title}")
' || echo "_gh json parse failed_"
  else
    echo "_gh CLI not available_"
  fi
  echo ""
}

emit_walks() {
  echo "## R-MARTI-CANONICAL walks"
  echo ""
  if [[ ! -f "$WB" ]]; then
    echo "_WB not found_"
    echo ""
    return
  fi
  # Pull "[A HH:MM ... R-MARTI-CANONICAL vN ... <verdict>] from WB
  # entries, score if present.
  grep -oE '\[A [0-9]{2}:[0-9]{2}[^]]*R-MARTI-CANONICAL v[0-9]+[^]]*\]' "$WB" 2>/dev/null \
    | sort -u \
    | sed 's/^/- /' \
    | head -30
  echo ""
}

emit_dispatch_counters() {
  echo "## Dispatch / completion counters"
  echo ""
  if [[ ! -f "$WB" ]]; then
    echo "_WB not found_"
    echo ""
    return
  fi
  local dispatches completions push_oks
  dispatches=$(grep -cE '^\[B [0-9]{2}:[0-9]{2}.*→ C' "$WB" 2>/dev/null || echo 0)
  completions=$(grep -cE '^\[C [0-9]{2}:[0-9]{2}.*(DONE|PUSH OK|PR #[0-9]+ OPEN|PR #[0-9]+ MERGED)' "$WB" 2>/dev/null || echo 0)
  push_oks=$(grep -cE '^\[C [0-9]{2}:[0-9]{2}.*PUSH OK' "$WB" 2>/dev/null || echo 0)
  echo "- [B → C] dispatches: ${dispatches}"
  echo "- [C] completions (DONE / PUSH OK / PR OPEN / PR MERGED): ${completions}"
  echo "- [C PUSH OK] entries: ${push_oks}"
  echo ""
}

emit_daemons() {
  echo "## Daemon + infra health"
  echo ""
  echo '```'
  if [[ -x "$REPO/scripts/check-daemons.sh" ]]; then
    bash "$REPO/scripts/check-daemons.sh" 2>&1 || true
  else
    echo "_check-daemons.sh not present in $REPO/scripts/_"
  fi
  echo '```'
  echo ""
}

emit_wb_size() {
  echo "## Work-board file"
  echo ""
  if [[ -f "$WB" ]]; then
    local size
    size=$(ls -lh "$WB" | awk '{print $5}')
    local lines
    lines=$(wc -l < "$WB")
    echo "- Size: $size"
    echo "- Lines: $lines"
  else
    echo "- _WB not found at $WB_"
  fi
  echo ""
}

main() {
  emit_header
  emit_merged_prs
  emit_open_prs
  emit_walks
  emit_dispatch_counters
  emit_daemons
  emit_wb_size
}

main "$@"

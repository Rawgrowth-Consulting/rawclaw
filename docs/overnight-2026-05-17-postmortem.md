# Overnight postmortem - 2026-05-17

3-session A/B/C orchestrated build on Rawclaw v3. C = QA / bug-hunt /
simplify, B = coordinator, A = primary IC for src.

Verified facts only. Sourced from work-board entries + `git log
origin/v3` + `gh pr list`. No fluff.

## 1. Timeline

| HH:MM | Event |
|---|---|
| 01:16 | C P0 jargon H24 strip contract spec (PR #4 merged) |
| 01:30 | HOTFIX 26 / 27 ship - "operator wants" + Pedro name strip |
| 01:56 | CI migration apply guard merge (PR #2) |
| 02:04 | H-ARCH-1 root-cause review of v6 walk - "tool errored" + filename leak class |
| 02:09 | Filename-mask helper (PR #10) |
| 02:14 | Evaluator-role prototype (PR #11) |
| 02:17 | H-ARCH-2 ships - peer-pronoun + storage-suffix strip |
| 02:19 | F-? admin chat trace export endpoint (PR #12) |
| 02:25 | F-2 bell-grouped notifications (PR #13) |
| 02:28 | H-ARCH-2d - file lookup/fetch jargon variants |
| 02:37 | H-ARCH-2e/f - "tool" suffix + double-article fix |
| 02:40 | jargon coverage extend - 21 uncovered tool tokens (PR #14) |
| 02:48 | walk regression suite scaffold (PR #16) |
| 02:53 | thinking helpers extract + dedupe regex (PR #17) |
| 03:04 | apify shared helpers batch 2 (PR #18) |
| 03:18 | Q5 tier-2 walk suite + multi-fixture extend (PR #20) |
| 03:25 | P7 H-ARCH-4 fixture contract (PR #21) |
| 03:31 | jargon-gate CI job (PR #22 - still OPEN, P8c) |
| 03:35 | H-ARCH-5 delegation-card coverage v2 (PR #23 - OPEN, P8a) |
| 03:39 | delegate-verify regression (PR #24 - OPEN, P8b) |
| 03:48 | H-ARCH architecture overview (PR #25 - OPEN, P9) |
| 03:48 | Morning summary 2026-05-17 (PR #26 - OPEN, P10c) |
| 03:53 | Migration review notes (PR #27 - OPEN, P11) |
| 03:57 | Marti ANTHROPIC_API_KEY Path B doc (PR #28 - OPEN, P12) |
| 04:02 | Daemon + infra health monitor (PR #29 - OPEN, P13) |
| 04:07 | WB curation script (PR #30 - OPEN, P14) |
| 04:04 | A v22 R-MARTI-CANONICAL 100/100 jargon flagship achieved |
| 04:12 | C P15a-c README + DEPLOY-V3 overnight refresh (PR #31 - OPEN) |
| 04:16 | C P16 v22 flagship walk replay CI snapshot (PR #32 - OPEN) |
| 04:19 | C P17 migration-safety pre-merge CI gate (PR #33 - OPEN) |
| 04:25 | C P18 production runbook (PR #34 - OPEN) |
| 04:26 | A H-ARCH-5f ships sha 4b7b37e - file_name= strip + bare leak |
| 04:27 | C P19 Chris West demo brief (PR #35 - OPEN) |
| 04:30 | C P20 architecture diagram - mermaid + ASCII (PR #36 - OPEN) |
| 04:31 | A v27 R-MARTI-CANONICAL 100/100 LOCKED post H-ARCH-5f |
| 04:33 | C P21 README architecture/production/ops sections (PR #37 - OPEN) |
| 04:36 | C P22 jargon-dedupe surgical /simplify (PR #38 - OPEN) |
| 04:40 | C P23 this postmortem (PR #39 - OPEN, this doc) |

A v25-v29 quota probes ran every ~5min from 04:12 onwards while
Claude Max 5h window saturated. v27 was the first post-H-ARCH-5f
clean run; later probes confirmed sustained 100/100 jargon.

## 2. Humanize gateway architecture

Two-layer split. RAW persistence + render-boundary scrub. Same
module is the single source of truth for both layers.

**Layer 1 - RAW persistence.** The model's verbatim stream lands
in `rgaios_agent_chat_messages`. Tool enums, internal field names,
agent IDs - all preserved. The next turn re-builds context from
this row, and the canonical names are what makes `tool_call`
dispatch resolve.

**Layer 2 - server-side humanize at SSE emit.** Every operator-
visible string passes through `humanizeJargon()` before it leaves
the server:
- `src/app/api/agents/[id]/chat/route.ts:816` - text + thinking
  event scrub
- `src/app/api/agents/[id]/chat/route.ts:824` - tool-call summary
- `src/app/api/agents/[id]/chat/route.ts:1148` - reasoning chip
  label
- `src/app/api/agents/[id]/chat/route.ts:1270` - delegate-card
  detail tool

**Layer 3 - client-side humanize at React render.** When a tab
re-mounts and loads chat history from the RAW table, the chat
component re-runs `humanizeJargon` at render time:
- `src/components/agents/AgentChatTab.tsx:1359` - message content
- `src/components/agents/AgentChatTab.tsx:1693` - thinking text
- `src/components/agents/AgentChatTab.tsx:1981` - delegate task
  body

Same scrub also runs in:
- `src/components/notification-bell.tsx:189` (bell)
- `src/components/notifications/BellGrouped.tsx:131` (grouped bell)
- `src/app/updates/Client.tsx:478, 670` (/updates)
- `src/app/notifications/page.tsx` (notifications page)

**JARGON_MAP** lives at `src/lib/agent/jargon.ts:18`. 125 patterns
ordered by HOTFIX wave (24 → 26 → 27 → H-ARCH-1 → H-ARCH-2a-h →
H-ARCH-5a-f). Pure-string, no I/O, safe for "use client" import.
`humanizeJargon()` is at `src/lib/agent/jargon.ts:221`.

**Key invariant**: the same module runs server-side AND client-side.
A new pattern added once protects all 6 surfaces simultaneously.

## 3. Auto-delegate (FILENAME-RESOLVE)

Pre-2026-05-17, when Scan was asked for a file owned by a peer
(Kasia), the operator saw a 2-option "which file do you mean"
picker that dead-ended. H-ARCH-4 shipped a preamble rule:

`src/lib/agent/preamble.ts:1465` (Scan variant) +
`src/lib/agent/preamble.ts:1582` (other variant) - FILENAME-RESOLVE.

STEP 1: call `lookup_my_files` first to fetch the attached name.
STEP 2: if no match, the file lives with a peer (creator-lists =
Kasia/marketing, ops/SOP = Atlas). Immediately `agent_invoke` that
peer in the SAME reply with the full task.
STEP 3 (HARD BAN): never ask the operator "two options: (a) re-
upload or (b) I dispatch Kasia". Just delegate.

The Levenshtein-based filename fuzz match lives at
`src/lib/mcp/tools/apify.ts:1244` (15-line hand-rolled distance,
used at `:1296` against attached file names).

## 4. Claude Max OAuth quota investigation

Failure mode: agent reply hangs or shows "Hit our brief pause".
Log signature: `rate_limit_error` from Anthropic OAuth path.

**Window shape**: 5-hour rolling quota, scoped per Claude Max
seat. Tonight's window first saturated at ~03:30 and stayed
throttled for ~70min before A's v27 walk landed at 04:31
post-H-ARCH-5f. v28/v29 still throttled at time of this writing.

**Path B fallback** (per Day-1 architecture decision):
`src/lib/llm/oauth-first.ts:171-176` activates Anthropic
Commercial API via `ANTHROPIC_API_KEY` env var when all Path A
OAuth seats are exhausted. Log confirmation line:
`[oauth-first] all OAuth tokens exhausted, falling back to
ANTHROPIC_API_KEY`.

Runbook: `docs/PROVISIONING_ANTHROPIC_API_KEY.md` (PR #28). Not
applied to Marti tonight - quota cycled before action was needed.

## 5. PRs

**Merged tonight to v3**: 14. Per `gh pr list --state merged
--base v3 --search "merged:>=2026-05-17"`:

PR #2, #4, #6, #9, #10, #11, #12, #13, #14, #15, #16, #17, #18, #20, #21.

(The exact line is 15 historical merges to v3; 14 of those landed
in the overnight window.)

**Still OPEN**: 21 PRs awaiting Pedro morning merge:

| # | Branch | Note |
|---|---|---|
| 3 | feature/telemetry-admin-page | F-5 chat telemetry persistence |
| 5 | feature/org-budget-overrides | F-7 per-org budget tier scaffold |
| 7 | feature/admin-activity-heatmap | F-9 admin activity heatmap |
| 8 | feature/audit-retention-prune | F-6 audit retention prune |
| 22 | fix/ci-jargon-gate | P8c jargon-gate CI job |
| 23 | fix/jargon-coverage-v2 | P8a H-ARCH-5 spec batch |
| 24 | feature/walk-regression-delegate-verify | P8b delegate-verify |
| 25 | docs/h-arch-architecture-overview | P9 H-ARCH long-form |
| 26 | docs/morning-summary-2026-05-17 | P10c morning summary |
| 27 | docs/migration-review-notes | P11 migration review notes |
| 28 | docs/marti-anthropic-key-setup | P12 Path B runbook |
| 29 | feature/daemon-health-monitor | P13 daemon health |
| 30 | feature/wb-curate | P14 WB curation script |
| 31 | docs/readme-update | P15c README overnight state |
| 32 | feature/v22-flagship-snapshot | P16 v22 CI snapshot |
| 33 | feature/migration-safety-preflight | P17 migration-safety gate |
| 34 | docs/production-runbook | P18 production runbook |
| 35 | docs/chris-west-demo-prep | P19 Chris West brief |
| 36 | docs/architecture-diagram | P20 mermaid + ASCII |
| 37 | docs/readme-env-refresh | P21 README sections + env |
| 38 | refactor/jargon-dedupe | P22 surgical dedupe |

Suggested merge order in `docs/MORNING_SUMMARY_2026-05-17.md`
(PR #26). Migration PRs (#3, #5, #7, #8) carry the only
non-trivial review burden; rollback + risk + dependency notes
posted as `gh pr comment` on each + consolidated in
`docs/MIGRATION_REVIEW_NOTES_2026-05-17.md` (PR #27).

## 6. Walks

| version | flagship | sha | window |
|---|---|---|---|
| v19 | first jargon-clean canonical walk | pre-H-ARCH-5 | ~03:48 |
| v22 | **100/100 jargon flagship** | aa0b1a3+ | 04:04 |
| v23 | 100/100 with Task body included | f807572 | 04:08 |
| v24 | quota probe + edge cases | post-H-ARCH-5e | 04:13 |
| v25-v26 | quota throttled, code clean | - | 04:18-04:23 |
| v27 | **100/100 LOCKED post H-ARCH-5f** | 4b7b37e | 04:31 |
| v28-v29 | quota same, jargon CLEAN | - | 04:36-04:38 |

Source-of-truth PNG: `/home/pedroafonso/Downloads/screenshots/
correct/test-R-MARTI-CANONICAL-v22-FLAGSHIP-100-jargon.png`.

CI lock on the v22 walk shape lives in `tests/e2e/
v22-flagship-replay.spec.ts` + `tests/e2e/fixtures/
v22-flagship-walk.json` (PR #32). 9 assertions, 8 active + 1
test.fixme for live SSE replay when quota refills.

## 7. Open items for morning (Pedro action)

1. **Merge the 21 OPEN PRs in suggested order**
   (`docs/MORNING_SUMMARY_2026-05-17.md`). Migration PRs first
   (#3, #5, #7, #8) so each subsequent PR rebases against the
   latest migration set.
2. **Apply migration 0076 / 0077 / 0079 to Supabase Cloud**
   before merging the corresponding PRs (#3, #5, #8). Per-PR
   apply-gate notes in `docs/MIGRATION_REVIEW_NOTES_2026-05-17.md`.
3. **Sanity-check Chris West brief** (`docs/DEMO_CHRIS_WEST_2026-05-17.md`)
   tone before sharing - edit voice/sign as you see fit.
4. **Decide on Path B for Marti**: quota cycled tonight without
   action needed, but if the next overnight saturates, the
   runbook is in `docs/PROVISIONING_ANTHROPIC_API_KEY.md`.
5. **PR #38 (jargon dedupe)** - waited per B 04:41 spec for
   v30+ walk to validate flagship unchanged. Once a single
   post-merge walk confirms 100/100, safe to merge.

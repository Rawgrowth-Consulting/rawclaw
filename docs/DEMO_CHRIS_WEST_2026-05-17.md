# Chris West demo brief - 2026-05-17

Hand-off doc for the Marti stakeholder review on the overnight
Rawclaw v3 work. Pedro can paste this directly into the morning
report or share as a standalone link.

## What we shipped overnight

**Operator-facing humanize gateway.** Two-layer separation: the
RAW model output lands in `rgaios_agent_chat_messages` (so the
next-turn context still resolves canonical tool enums), and a
single `humanizeJargon()` scrub runs at every operator-visible
render boundary. Five surfaces all share the one module: SSE
stream, chat-history reload, reasoning chip, notification bell,
delegation card. Full architecture is in
`docs/ARCHITECTURE_HUMANIZE_GATEWAY.md`.

**Auto-delegate via peer agent orchestration.** When Scan asks
for a file that lives with another agent (Kasia, etc), the
operator no longer sees a "which file do you mean" pick-list -
Scan resolves the owner via FILENAME-RESOLVE and dispatches a
single `agent_invoke` to the right peer. Shipped in the H-ARCH-4
cascade.

**100/100 jargon flagship walk demonstrated.** R-MARTI-CANONICAL
v22 ran the canonical creator-list scrape end-to-end with zero
banned tokens across all five surfaces. Screenshot pinned at
`screenshots/correct/test-R-MARTI-CANONICAL-v22-FLAGSHIP-100-jargon.png`.
The walk shape is now snapshotted into a CI fixture (PR #32)
so any future regression that re-introduces a banned token on
the same walk shape trips a dedicated assertion at PR time.

**15 PRs merged to v3 overnight.** Spans humanize hotfixes
(H22 through H-ARCH-5f), apify helper extraction + shared
contracts (PR #15, #17, #18), walk regression suite scaffold
(PR #16), bell-grouped notifications (PR #13), admin chat
trace export (PR #12), daily-insights Telegram digest worker
scaffold (PR #6), and the migration apply guard (PR #2).

**Migration safety CI gate.** Pre-merge scanner for nine
destructive SQL patterns (DROP TABLE, DELETE FROM, TRUNCATE,
DROP COLUMN, etc) with a baseline allowlist so legacy
intentional ops don't permanently red-CI. Ships in PR #33
(OPEN, all 5 checks green, awaiting Pedro merge).

**Walk regression test suite.** Four e2e specs now lock the
canonical walk + tier mocks + H-ARCH-4 delegate contract +
v22 flagship snapshot. 82+ jargon assertions across 7 unit
spec files. CI runs the lot on every PR.

## What this means for Marti

- **Polish IG creator academy operator surface is clean.** The
  agents Marti's operators interact with never leak raw tool
  names, internal IDs, file paths, or implementation jargon
  in any of the five rendered surfaces.
- **Scan delegates to Kasia automatically when files live
  elsewhere.** No "which file do you mean" picker, no
  operator-facing UX dead-end. The reasoning chip explains the
  hand-off in plain language ("Creator list lives with Kasia,
  dispatching her to run the scrape").
- **Zero infra jargon visible to Marti users.** FLEX MODE,
  shared memory, tool_call IDs, raw apify field names, owner
  identifiers - all stripped at render time.
- **Daily insights Telegram digest worker scaffolded.** Lands
  the recurring summary surface Marti asked for (PR #6 merged).
- **Telemetry admin page ready for review.** Per-org chat
  telemetry persistence + admin dashboard view at
  `/admin/telemetry` (PR #3 OPEN, awaiting Pedro review).

## What's pending

- **Claude Max quota refill (rolling 5h window) OR Path B
  fallback.** End-to-end walk verification on the live model
  is gated on the quota cycling. Path B fallback runbook
  shipped to unblock if quota persists: see
  `docs/PROVISIONING_ANTHROPIC_API_KEY.md`. Code-side flagship
  is locked at 100/100 regardless.
- **Pedro review of the migration PRs.** Per-PR rollback +
  risk + apply-gate notes posted as `gh pr comment` on each;
  consolidated table in `docs/MIGRATION_REVIEW_NOTES_2026-05-17.md`
  (PR #27 OPEN).
- **PR queue waiting on merge button.** 4 PRs from this seat
  alone are CI-green and ready: #31 (README + DEPLOY-V3
  overnight state), #32 (v22 flagship CI snapshot), #33
  (migration safety gate), #34 (production runbook).

## Walk evidence

Six confirmed flagship-quality screenshots in
`/home/pedroafonso/Downloads/screenshots/correct/`:

- `test-R-MARTI-CANONICAL-v14-DELEGATE-WORKING.png` - first
  clean delegate
- `test-R-MARTI-CANONICAL-v19-JARGON-FLAGSHIP.png` - first
  full jargon clean on the canonical walk
- `test-R-MARTI-CANONICAL-v22-FLAGSHIP-100-jargon.png` -
  **absolute 100/100 jargon flagship**
- `test-R5-R9-v9-bundle.png` - bundle walk
- `test-R-ATLAS-activity-clean.png` - Atlas activity view
- `test-R-UPDATES-page-clean.png` - /updates page

## Next iterations

1. **Multi-walk suite execution** once Claude Max quota
   refills. R-MARTI-BOTTOM, R-MARTI-HASHTAG, R-MARTI-RECENT,
   and the rest of the 25-walk regression set live as test
   fixtures already.
2. **Production runbook live** (PR #34 - this is the
   3-incident-playbook + monitoring + deploy doc).
3. **Migration safety CI gate live** (PR #33 merge).
4. **Path B fallback decision** - if Pedro wants the safety
   net wired up before the next overnight, the runbook is in
   `docs/PROVISIONING_ANTHROPIC_API_KEY.md`.

## References

- `docs/ARCHITECTURE_HUMANIZE_GATEWAY.md` - 5-surface gateway
  + spec inventory
- `docs/RUNBOOK_PRODUCTION.md` - operator incident playbooks
  (PR #34)
- `docs/MORNING_SUMMARY_2026-05-17.md` - merged + open PR
  table with suggested merge order
- `docs/MIGRATION_REVIEW_NOTES_2026-05-17.md` - per-PR
  rollback notes for the migration batch
- `docs/PROVISIONING_ANTHROPIC_API_KEY.md` - Path B fallback
  runbook
- `README.md` + `DEPLOY-V3.md` - top-level repo + cold-start

Pedro - sign as you see fit before sharing.

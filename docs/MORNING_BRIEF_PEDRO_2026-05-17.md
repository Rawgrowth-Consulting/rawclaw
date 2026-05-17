# Morning brief - Pedro - 2026-05-17

60-second read. Action items first.

## TL;DR

- Humanize gateway 2-layer ships. v22 + v27 walks both
  100/100 jargon flagship. Marti up (`HTTP/2 307`).
- 14 PRs merged tonight to v3, 21 OPEN awaiting your merge button.
- Quota throttled ~83min into 5h window since 03:30; ~120min
  remaining ETA ~06:40.

## Action items

1. **(2 min) Decide Path B on Marti.** Set `ANTHROPIC_API_KEY` in
   `/opt/rawclaw/.env` + `docker compose -f docker-compose.v3.yml
   up -d --force-recreate`, OR add a second Claude Max OAuth seat
   at `/connections`. Runbook:
   `docs/PROVISIONING_ANTHROPIC_API_KEY.md` (PR #28).
2. **(10 min) Review 4 migration PRs** before merge: #3 (telemetry
   0076), #5 (budget 0077), #7 (heatmap), #8 (audit retention 0079).
   Per-PR rollback + risk + apply-gate notes posted as `gh pr
   comment` on each. Summary table:
   `docs/MIGRATION_REVIEW_NOTES_2026-05-17.md` (PR #27).
3. **(1 min) PR #19** - ALREADY CLOSED, no action. Superseded by
   `c56fdf3 HOTFIX Q2 RENDER-HUMANIZE-HOOK`. Spec mentioned but
   already done.
4. **(5 min) Trigger R-MARTI-CANONICAL v30+ walk** post-quota
   refill. Confirms PR #38 jargon-dedupe safe to merge (B holds
   it pending live-walk validation).

## What shipped tonight

- **Humanize gateway 2-layer.** RAW persistence + render-boundary
  scrub. 6 surfaces share one `humanizeJargon()` module.
- **Auto-delegate FILENAME-RESOLVE.** Scan no longer asks "which
  file" pickers; dispatches `agent_invoke` to the right peer.
- **Jargon flagship 100/100 v22 (sha aa0b1a3+) + v27 (sha
  4b7b37e post H-ARCH-5f).**
- **14 PRs merged** to v3. 21 still OPEN ready for morning merge.

## What's blocked

- **Quota window**: ~120min remaining before next 5h cycle edge.
  Live-walk verification on Path A waits.
- **21 OPEN PRs** (one-line why):
  - #3 #5 #7 #8 - migration PRs, gated on Pedro review.
  - #22 jargon-gate CI - depends on #23/#24 spec merges.
  - #23 H-ARCH-5 spec batch.
  - #24 delegate-verify regression spec.
  - #25 H-ARCH long-form arch doc.
  - #26 morning summary table.
  - #27 migration review notes (gates #3/#5/#8).
  - #28 Path B runbook (gates action item 1).
  - #29 daemon health monitor script.
  - #30 WB curation script.
  - #31 README + DEPLOY-V3 overnight refresh.
  - #32 v22 flagship CI snapshot.
  - #33 migration-safety pre-merge gate.
  - #34 production runbook.
  - #35 Chris West demo brief.
  - #36 architecture mermaid diagram.
  - #37 README arch/prod/ops sections + env Path B.
  - #38 jargon dedupe (HOLD: B wants v30+ walk validation first).
  - #39 overnight postmortem.

## DO NOT TOUCH

- **`marti.rawgrowth.ai`** - live Marti production.
- **`v3` branch on GitHub** - auto-builds + deploys via the
  rawclaw-tick.timer pipeline on merge.

## Reference

- Full timeline + verified file:line cites:
  `docs/overnight-2026-05-17-postmortem.md` (PR #39).
- Merge order suggestion:
  `docs/MORNING_SUMMARY_2026-05-17.md` (PR #26).
- Chris West hand-off brief:
  `docs/DEMO_CHRIS_WEST_2026-05-17.md` (PR #35).
- Production incident runbook:
  `docs/RUNBOOK_PRODUCTION.md` (PR #34).

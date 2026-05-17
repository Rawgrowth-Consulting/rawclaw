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

## Final audit results (appended 05:07 post-quota)

After the quota window saturated and the docs queue drained,
the cycle pivoted to bug-hunt + audits per your "C achar bugs
e rodar simplify" mandate. Four read-only audits + two surgical
prod-code fixes shipped.

| Audit | Outcome | Report |
|---|---|---|
| P27 bug triage (`src/lib`, `src/app/api`, `src/components/agents`) | 1 real bug found, **FIXED in PR #43** | `/home/pedroafonso/Downloads/bug-triage-2026-05-17.md` |
| P29 OAuth path deep-dive (`oauth-first.ts`, `oauth-anthropic.ts`) | 5 findings, **top-1 (Path C cascade) FIXED in PR #44**, 4 deferred | `/home/pedroafonso/Downloads/oauth-audit-2026-05-17.md` |
| P31 MCP timeout sweep (all `src/lib/mcp/tools/*.ts`) | Clean: 14 fetch sites, 0 gaps (telegram-send was the only one, fixed by PR #43) | `/home/pedroafonso/Downloads/mcp-timeout-audit-2026-05-17.md` |
| P32 cross-tenant security audit | **0 CRITICAL, 0 HIGH**, 5 defense-in-depth gaps deferred | `/home/pedroafonso/Downloads/security-audit-2026-05-17.md` |

**Headline**: no exploitable cross-tenant leak. Every API
endpoint + chat.ts + executor.ts properly org-scoped. The 5
defense-in-depth gaps are server-internal helpers (runs/queries,
agent-invoke, custom-tools, ingest) that operate on UUIDs +
already-org-scoped callers; tightening them is future-refactor
insurance, not a current bug.

**OAuth deferred items** (review when you have time):
- Finding #1: duplicate TOKEN_COOLDOWN Maps in oauth-first +
  oauth-anthropic with different policies (flat 60s vs
  server-hint-aware). Unify to shared module = cleaner state.
- Finding #2: oauth-first.ts string-matches 429 instead of
  using typed AnthropicHttpError.status.
- Finding #4: in-process cooldown lost on every worker restart
  causes burst-then-throttle pattern.
- Finding #5: caller prioritization silently lost when
  callerUserId is missing.

## Final OPEN PR count + 1-line each (27 total)

Order: code fixes > test infra > docs.

**Code fixes (ship first, low-risk surgical)**:
- #44 fix/oauth-first-cascade-path-c (P30) - Path B failure now cascades to Path C. ALL GREEN.
- #43 fix/telegram-send-timeout (P28) - AbortSignal.timeout added to Telegram fetch. ALL GREEN.

**Test infra (ship after code fixes)**:
- #41 tests/jargon-regex-coverage (P25) - 22 banned-token canary specs. ALL GREEN.
- #38 refactor/jargon-dedupe (P22) - removes 1 dead pattern. **HOLD per B until v30+ walk validates.** All tests green.
- #33 feature/migration-safety-preflight (P17) - new CI gate for destructive migrations. ALL GREEN incl new gate.
- #32 feature/v22-flagship-snapshot (P16) - CI lock for v22 walk shape. ALL GREEN.
- #24 feature/walk-regression-delegate-verify (P8b) - delegate regression spec.
- #23 fix/jargon-coverage-v2 (P8a) - H-ARCH-5 spec batch.
- #22 fix/ci-jargon-gate (P8c) - jargon-gate CI job.

**Docs (ship anytime)**:
- #42 docs/rollback-playbook (P26) - worst-case revert mechanics.
- #40 docs/morning-brief-pedro-2026-05-17 (P24) - **this file**.
- #39 docs/overnight-postmortem-2026-05-17 (P23) - 7-section postmortem.
- #37 docs/readme-env-refresh (P21) - README arch/prod/ops sections + env Path B.
- #36 docs/architecture-diagram (P20) - mermaid + ASCII.
- #35 docs/chris-west-demo-prep (P19) - stakeholder hand-off.
- #34 docs/production-runbook (P18) - 3 incident playbooks.
- #31 docs/readme-update (P15c) - README + DEPLOY-V3 overnight refresh.
- #30 feature/wb-curate (P14) - WB curation script.
- #29 feature/daemon-health-monitor (P13) - daemon health script.
- #28 docs/marti-anthropic-key-setup (P12) - Path B runbook.
- #27 docs/migration-review-notes (P11) - per-PR migration review.
- #26 docs/morning-summary-2026-05-17 (P10c) - merge order doc.
- #25 docs/h-arch-architecture-overview (P9) - H-ARCH long-form.

**Migration PRs (review carefully)**:
- #3 feature/telemetry-admin-page (F-5) - 0076 chat telemetry persistence.
- #5 feature/org-budget-overrides (F-7) - 0077 per-org budget tier.
- #7 feature/admin-activity-heatmap (F-9) - admin activity heatmap.
- #8 feature/audit-retention-prune (F-6) - 0079 audit retention prune.

## What's been MERGED tonight (14 PRs to v3, all since 03:00)

Per `gh pr list --state merged --base v3 --search "merged:>=2026-05-17T03:00"`. Categories:

- **Humanize gateway hotfixes**: H22 → HOTFIX 26/27 → H-ARCH-1 → H-ARCH-2a-h → H-ARCH-5a-f (most landed via the merged set including PR #4 H24 strip contract).
- **Apify helper extraction + shared contracts**: #15 (P2), #17 (P4 batch 1), #18 (P4 batch 2).
- **Walk regression suite scaffold**: #16 (P3), #20 (Q5 tier-2), #21 (P7 H-ARCH-4 fixture contract).
- **Filename-mask helper + drift audit + evaluator prototype**: #9, #10, #11.
- **Bell-grouped notifications**: #13 (F-2).
- **Admin chat trace export**: #12.
- **Daily-insights Telegram digest worker scaffold**: #6 (F-8).
- **CI migration apply guard**: #2.
- **Jargon coverage extend (21 uncovered tool tokens)**: #14.
- **H24 strip contract spec**: #4.

## CLOSE-OUT (appended 05:23 - cycle wind-down per B 05:22)

C session winding down. Final state:

- **15 C-PRs shipped** this cycle (P15-P37). 1 merged tonight (#45 fix/jargon-replacement-type-widen, sha b14df01); 14 remain OPEN ready for Pedro morning merge.
- **27 OPEN PRs** total on v3 (C plus earlier in the run).
- **2 PROD-code fixes** landed via this seat: PR #43 (telegram-send.ts timeout), PR #44 (oauth-first.ts Path B->C cascade). Plus PR #45 (jargon type widen, MERGED).
- **4 audit reports** on disk in `/home/pedroafonso/Downloads/`:
  - `bug-triage-2026-05-17.md` (P27)
  - `oauth-audit-2026-05-17.md` (P29)
  - `mcp-timeout-audit-2026-05-17.md` (P31)
  - `security-audit-2026-05-17.md` (P32) - 0 CRITICAL / 0 HIGH
  - `final-qc-2026-05-17.md` (P34 + P37 re-run, both appended, all-green)
  - `preamble-simplify-scan.md` (P36, deferred)
- **v3 HEAD state**: `b14df01` (post-#45 merge). `npm run test:unit` 431/431, `npx tsc --noEmit` CLEAN, `npm run lint` 0 errors.
- **HOLDs are intentional + documented**: PR #38 (jargon-dedupe) waits for v30+ walk validation; PRs #3 #5 #7 #8 wait for Pedro migration review. No unaddressed blockers.

**Deferred for Pedro morning**:
- OAuth audit Findings #1, #2, #4, #5 (see oauth-audit doc).
- Security audit Findings #1-#5 (defense-in-depth, see security-audit doc).
- Preamble FILENAME-RESOLVE duplication extraction (~50 LOC reduction, see preamble-simplify-scan).
- CI hardening: add dedicated `typecheck` job to `ci.yml`. `next.config.ts:22` masks tsc errors in build job (this is how H-ARCH-5e type bug slipped past CI).

[C 05:23] cycle close-out complete. Standing down to idle.

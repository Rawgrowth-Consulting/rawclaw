# Morning summary - 2026-05-17

Overnight rollup for Pedro. Window: ~17:00 BRT 2026-05-16 →
04:00 BRT 2026-05-17. Compiled by Claude C session.

## Headlines

- **14 C PRs merged to v3.** 10 more C PRs still OPEN, all CI
  green, queued for Pedro morning review.
- **9 hotfix waves shipped by A** (H22 → H-ARCH-5b)
  consolidated the operator-vocab leak into the H-ARCH
  two-layer gateway pattern.
- **Marti** stayed at ~99% uptime (brief 502 blips during
  force-recreate deploys, no extended outage).
- **R-MARTI-CANONICAL walks**: v2 → v19 attempted overnight.
  Code-side flagship achieved at v15+; remaining attempts
  blocked on Claude Max quota refill (real infra constraint,
  not code).

## C PRs merged tonight (chronological)

| #   | Title                                                                       | Merged    |
| --- | --------------------------------------------------------------------------- | --------- |
| 4   | tests(jargon): H24 strip contract spec                                      | 05:40 UTC |
| 6   | F-8: daily-insights Telegram digest worker                                  | 05:41 UTC |
| 10  | feat(util): filename-mask helper                                            | 06:15 UTC |
| 14  | tests(jargon): coverage extend for 21 uncovered tool tokens                 | 06:46 UTC |
| 15  | feat(apify): extract shared helpers                                         | 06:47 UTC |
| 11  | spike: evaluator-role prototype                                             | 06:48 UTC |
| 12  | F-?: admin chat trace export endpoint + page                                | 06:48 UTC |
| 9   | feat: supabase migration drift audit worker                                 | 07:04 UTC |
| 13  | F-2: bell-grouped notifications + /notifications page                       | 07:04 UTC |
| 16  | test(e2e): walk regression suite scaffold                                   | 07:04 UTC |
| 17  | refactor(thinking): extract helpers + dedupe regex                          | 07:04 UTC |
| 18  | feat(apify): batch 2 shared helpers - comments / errors / handles / args    | 07:10 UTC |
| 20  | test(e2e): Q5 tier-2 walk suite + multi-fixture extend                      | 07:29 UTC |
| 21  | test(e2e): H-ARCH-4 fixture contract                                        | 07:29 UTC |

## C PRs still OPEN (10) - Pedro morning review queue

All have CI green (build / lint / test / migrations).

Migrations - require apply to cloud before merge:

| #  | Title                                                                 | Migration  |
| -- | --------------------------------------------------------------------- | ---------- |
| 3  | F-5 telemetry admin page + sink                                       | 0076       |
| 5  | F-7 per-org chat budget tier overrides                                | 0077       |
| 8  | F-6 v1 audit_log 90-day retention prune                               | 0079       |

Pure code / docs - safe parallel merge:

| #  | Title                                                                 |
| -- | --------------------------------------------------------------------- |
| 7  | F-9 admin chat-activity heatmap page                                  |
| 17 | refactor(thinking): extract helpers + dedupe regex                    |
| 22 | ci(jargon-gate): pre-deploy operator-vocab regression check           |
| 23 | tests(jargon): H-ARCH-5 delegation-card coverage v2                   |
| 24 | test(e2e): delegate-verify regression (H-ARCH-4 contract)             |
| 25 | docs: H-ARCH humanize-gateway architecture overview                   |

Suggested merge order (safest first):

1. #22 ci-jargon-gate (.github only)
2. #25 docs (docs/ only)
3. #17 thinking refactor (1:1 behavior preserved)
4. #23 #24 (test/fixture only)
5. #7 F-9 heatmap (admin page, reads existing telemetry)
6. Apply mig 0076 to cloud, then merge #3 F-5
7. Apply mig 0079 to cloud, then merge #8 F-6
8. Apply mig 0077 to cloud, then merge #5 F-7

## A hotfix wave summary

A shipped 9 H-ARCH commits tonight focused on the operator-vocab
leak:

- H-ARCH-1: SSE gateway + preamble negative + list_files redact
- H-ARCH-2 through H-ARCH-2h: jargon micro-patches, residuals,
  filename singular variants, peer-pronoun + storage suffix,
  proper-noun strip, narrative scrubs
- H-ARCH-3 (reverted): unblind model + knowledge suffix - was
  too aggressive
- H-ARCH-4 + H-ARCH-4b: FILENAME-RESOLVE auto-delegate to peer
  agents, hard-ban on user-choice ask
- H-ARCH-5 + H-ARCH-5b: delegation surface humanize per B 03:26
  spec, all command-card render paths

The architecture pattern is documented in
`docs/ARCHITECTURE_HUMANIZE_GATEWAY.md` (PR #25).

## Bugs C flagged (queued for A/B)

- `jargon.ts:167` `/\b\/connections\b/g` - `\b` boundary
  doesn't match leading `/`. `/connections` still leaks in
  retry messages. One-line fix (replace `\b` with lookaround).
  Flagged from `tests/unit/jargon-h-arch-5.spec.ts` test
  comment + commit body.

## Walk regression suite (CI-side, no infra needed)

4 e2e specs landed across PR #16/#20/#21/#24. Tier shape:

| Tier | What it asserts | Where |
|---|---|---|
| 1 (unit) | humanizeJargon mapping per token | tests/unit/jargon*.spec.ts (82 assertions) |
| 2 (mocked) | apify fixture + assertOperatorClean | tests/e2e/r-marti-*.spec.ts (active) |
| 2.5 (contract) | H-ARCH-4 delegate JSON fixture | tests/e2e/r-marti-h-arch-4-contract.spec.ts |
| 3 (live walk) | full local dev server | test.fixme stubs, promote post-quota |

CI now runs all jargon specs as a named `jargon-gate` job
(PR #22) so a humanizer regression flips one named light in
the PR UI instead of being buried in `test`.

## Pedro morning action items (from B 03:34)

1. Refill / expand Claude Max quota OR add account.
2. Review the 3 migration PRs (#3 #5 #8) + apply migrations
   to cloud before merge.
3. Approve & merge the 7 pure-code/docs PRs (suggested order
   above).
4. Trigger R-MARTI-CANONICAL v20 walk once quota path live
   to verify full flagship 95+ PASS.
5. Decide on the `jargon.ts:167` `/connections` boundary fix
   (one-line A or B lane).

## What was NOT done

- Tier 3 live walks: blocked on quota.
- apify.ts call-site swap to helpers landed in #15/#18 -
  helpers exist + tested, call sites still inline. Deferred
  to a future PR (low risk, high diff cost).
- audit_log PARTITION RANGE monthly (F-6 v2): v1 ships the
  prune gate only.
- Q1 org-level files migration + Q4 find_file_owner: bundled
  for post-flagship per A 03:11 ACK.

## Standing infra observations

- WB enforce-log hook caught one mis-registration of session
  IDs in `.claude-agents/` mid-night (C session was wrongly
  mapped to B); fixed at 03:00 by re-registering and blanking
  the stale B file. No commits lost.
- Branch hygiene clean: merged feature branches auto-delete on
  merge. No orphans worth pruning.

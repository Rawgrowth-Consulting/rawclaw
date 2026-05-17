# Rollback playbook - v3 / Marti

Pedro-facing. Worst case. No thinking required - copy/paste
the right block. Plays paired with `docs/RUNBOOK_PRODUCTION.md`
(incidents) but stripped to revert mechanics only.

Last updated: 2026-05-17 (P26 per B 04:47 -> C).

## When to roll back

| Symptom | Action |
|---|---|
| Marti `5xx` >2 minutes, retries don't recover | revert + redeploy |
| R-MARTI-CANONICAL jargon flagship walk fails post-deploy | revert |
| Migration apply errored on Supabase Cloud | forward-fix > rollback, but if forward-fix not viable: PITR |
| Walks pass but operator-visible jargon regression | revert |

If symptom is only in **one** surface (e.g. only the bell, not
SSE), prefer a forward-fix PR over a full revert. The humanize
gateway is intentionally a single module across all surfaces -
one well-scoped commit fixes all.

## Standard revert (clean v3)

```
git checkout v3
git pull origin v3
git revert <bad-sha>
git push origin v3
```

`<bad-sha>` is the breaking commit. Find it with:

```
git log --oneline origin/v3 -10
```

Push triggers CI + the `rawclaw-tick.timer` deploy pipeline.
~3 min to live on Marti.

## Emergency revert (v3 worktree-locked)

Edge case actually hit tonight: a long-running A session held
`/tmp/rawclaw-A-hotfix-12b` worktree on `v3`, so
`git checkout v3` failed with `'v3' is already used by worktree
at /tmp/rawclaw-A-hotfix-12b`. Standard revert above blocked.

Bypass: push a named-ref over `v3` directly, no local `v3`
checkout needed.

```
# from any branch that has the good state at its tip
git push origin <good-branch>:v3
```

Where `<good-branch>` is a local branch whose HEAD is the
desired state of `v3`. For example:

```
git fetch origin v3
git checkout -b rollback-v3 origin/v3~1   # one commit back
git push origin rollback-v3:v3
```

This bypasses the worktree lock because the push is by-name
on the remote, not a local checkout.

**Use ONLY when standard revert is mechanically blocked.** It's
still a push to `v3` that bypasses your local branch state -
double-check the source branch is what you intend.

## Verify post-revert

```
# 1. CI green on the revert commit
gh run list --branch v3 --limit 2

# 2. Marti uptime
curl -sI https://marti.rawgrowth.ai
# Expected: HTTP/2 307 (redirect to /portal)

# 3. Health endpoint
curl -sI https://marti.rawgrowth.ai/api/healthz

# 4. Re-run the canonical walk
npm run test:e2e -- tests/e2e/r-marti-h-arch-4-contract.spec.ts
# v22 flagship CI snapshot when PR #32 merges:
npm run test:e2e -- tests/e2e/v22-flagship-replay.spec.ts
```

If walk passes + healthz 200 + CI green, the revert is live
and safe.

## DO NOT

- **Force push** to `v3`. Use a revert commit instead. Force
  push destroys history and breaks anyone with the bad sha
  checked out elsewhere.
- **`git reset --hard origin/v3`** on a branch you care about.
  Discards uncommitted local work without warning.
- **`git push --no-verify`** to skip the WB enforce-log hook
  or pre-commit checks. The hook exists because a past
  protocol disaster (2026-05-17 17:00 per
  `/home/pedroafonso/scripts/enforce-log.sh:74`) showed up
  when nobody logged what they were about to push.

## Migration rollback

Migrations are the only revert class where forward-fix is
*usually* safer than reverting. Per
`docs/RUNBOOK_PRODUCTION.md` §"Migration rollback":

1. Cut a new `0079_..._fix.sql` migration that re-creates
   what was dropped / patches the broken function. Push as
   a normal PR.
2. If the bad migration is <24h old and data was lost,
   Supabase point-in-time restore is the only recovery
   path. Dashboard -> Database -> Backups.
3. Never manually `DROP` / `DELETE` / `TRUNCATE` against
   the live Cloud DB to "undo" a migration. That is a
   bigger disaster than the original one.

The pre-merge `migration-safety` CI gate (PR #33 once merged)
blocks destructive ops at PR time so this section only fires
in genuine accidents.

## Reference

- `docs/RUNBOOK_PRODUCTION.md` - full incident playbooks
  (Marti 502, Claude Max 429, migration rollback).
- `docs/MIGRATION_REVIEW_NOTES_2026-05-17.md` - per-PR
  rollback notes for tonight's migration batch.
- `docs/PROVISIONING_ANTHROPIC_API_KEY.md` - Path B
  fallback runbook.
- `docs/overnight-2026-05-17-postmortem.md` - timeline +
  shipped facts for context.

# Migration PR reviewer notes - 2026-05-17

Pedro morning prep per [B 03:53 → C] P11. Per-PR comments
posted via `gh pr comment`; this doc is the at-a-glance table.

## Summary table

| PR | Migration | Rollback                                          | Risk    | Dependencies     | Apply gate |
| -- | --------- | ------------------------------------------------- | ------- | ---------------- | ---------- |
| 3  | 0076      | `DROP TABLE rgaios_chat_telemetry`                | LOW     | none             | YES        |
| 5  | 0077      | `DROP TABLE rgaios_organization_budget_overrides` | LOW     | none             | YES        |
| 7  | none      | code revert                                       | NONE    | merge after #3   | NO         |
| 8  | 0079      | `DROP FUNCTION rgaios_audit_log_prune(int)`       | NONE    | none             | YES        |

Apply gate = whether `npm run apply-cloud-migrations` should run
before the merge. Three migrations to apply (0076 / 0077 / 0079).

## Per-PR detail

### PR #3 - F-5 telemetry admin page + sink (mig 0076)

- **Migration**: `0076_chat_telemetry.sql` - new
  `rgaios_chat_telemetry` table.
- **Rollback**: `DROP TABLE IF EXISTS rgaios_chat_telemetry`
  (no FK dependencies; the table is a fresh write sink).
- **Data impact**: pure write sink, one row per
  `composeChatPreamble` decision. Existing tables untouched.
- **Blast radius**: chat route + telegram webhook write via
  `persistChatTelemetry()`; failure path swallowed
  (`console.error` only). Telemetry never breaks chat.
- **Test coverage**: schema assertion in `tests/migrations/`,
  value-shape contract in unit specs.
- **Dependencies**: NONE. PR #7 reads from this table; merge
  #3 first.
- **Apply order**: `npm run apply-cloud-migrations` before
  merge to v3.

### PR #5 - F-7 per-org budget tier overrides (mig 0077)

- **Migration**: `0077_org_budget_overrides.sql` - new
  `rgaios_organization_budget_overrides` table + two SQL
  helpers (`rgaios_org_budget_override`,
  `rgaios_org_budget_overrides_for`).
- **Rollback**: drop the table + both functions; no data
  touched on rollback.
- **Data impact**: NEW table. `CHECK role IN
  ('ceo','deptHead','specialist')`, budget bounds 1..1M,
  UNIQUE (org, role). Empty table = global defaults still
  apply.
- **Blast radius**: NEW `/admin/budget-overrides` page + API
  route only. The consumer-side wiring into
  `computeChatBudget` is an A-lane follow-up; this PR is
  STORAGE + UI only.
- **Test coverage**: `tests/unit/budget-overrides.spec.ts`
  (BUDGET_ROLES alignment to the SQL CHECK).
- **Dependencies**: NONE.
- **Apply order**: `npm run apply-cloud-migrations` before
  merge.

### PR #7 - F-9 admin chat-activity heatmap

- **Migration**: NONE. Reads from `rgaios_chat_telemetry`
  added by PR #3.
- **Rollback**: pure code revert.
- **Data impact**: READ ONLY. `fetchAgentHeatmap` queries the
  telemetry sink. Returns empty agent list on the table-absent
  error path so the page renders an empty-state explanation
  if merged before #3.
- **Blast radius**: NEW `/admin/heatmap` page + API route
  only. No existing route changed.
- **Test coverage**: `tests/unit/heatmap.spec.ts` (16 tests
  - dow/hour math, tz shift across NY-vs-UTC boundary,
    top-10 cap, parseWindowDays 7/30/90).
- **Dependencies**: MUST merge AFTER PR #3, or accept the
  empty-state UI until #3 lands. No data corruption either
  way.
- **Apply order**: merge #3 first, then this PR. No new
  migration applied for #7.

### PR #8 - F-6 v1 audit_log 90-day retention prune (mig 0079)

- **Migration**: `0079_audit_log_retention.sql` - new
  `rgaios_audit_log_prune(retention_days int default 90)`
  function + ts-only covering index on existing
  `rgaios_audit_log`.
- **Rollback**: `DROP FUNCTION IF EXISTS
  rgaios_audit_log_prune(integer); DROP INDEX IF EXISTS
  rgaios_audit_log_ts_idx;` - no data touched.
- **Data impact**: ZERO at migration time. The function is
  invoked LATER by the worker; only then does it delete rows
  older than the retention window. v1 ships DELETE path
  (safe to apply against live Marti). PARTITION BY RANGE
  conversion deferred to v2.
- **Blast radius**: NEW worker
  `src/workers/audit-retention-prune.ts` called from cron.
  Not wired into hot path. Existing `rgaios_audit_log`
  writers (telemetry, agent events) unchanged.
- **Test coverage**: `tests/unit/audit-retention-prune.spec.ts`
  (10 tests - default 90, validation 1..3650, RPC dep
  boundary stub).
- **Dependencies**: NONE.
- **Apply order**: `npm run apply-cloud-migrations` before
  merge.

## Suggested merge sequence

1. Apply 0076 to cloud → merge #3
2. Apply 0079 to cloud → merge #8
3. Merge #7 (depends on #3, no migration)
4. Apply 0077 to cloud → merge #5

After each merge: `gh run list --branch v3 --limit 3` to
confirm CI stays green on v3, then `curl -sI
https://marti.rawgrowth.ai` to confirm Marti uptime.

## Risk legend

- **NONE**: rollback is a code revert; no schema or data
  change.
- **LOW**: rollback is a single `DROP` against a new object;
  no data lost since the object is freshly created and only
  read by new code.
- (No medium/high entries this batch - all four migrations
  are additive on fresh tables / functions or read-only.)

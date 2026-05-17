-- 0079: audit log 90-day retention (rgaios_audit_log_prune)
--
-- F-6 v1. rgaios_audit_log (created in 0001) has no retention. Every
-- tool_call, connection event, approval decision, auth probe writes
-- a row and the table grows monotonically forever. Already 6-figure
-- row counts on the busier orgs.
--
-- v1 strategy: keep the existing table, ship a prune SQL helper +
-- ts-only index, drive from a cron worker (src/workers/audit-
-- retention-prune.ts). Pure delete - no schema migration, no data
-- copy. Safe to apply against live Marti.
--
-- v2 (deferred to a separate PR): convert to PARTITION BY RANGE
-- (ts) monthly so DROP PARTITION replaces the row-level DELETE.
-- That conversion is a heavier ALTER + data migration; we want a
-- pruning gate in place first so the table stops growing while v2
-- is designed + tested.
--
-- Idempotent: IF NOT EXISTS / OR REPLACE throughout.

-- Cover the prune scan path so the delete is index-driven instead
-- of a full table scan.
create index if not exists rgaios_audit_log_ts_idx
  on rgaios_audit_log (ts);

-- Returns the number of rows deleted. Default 90-day retention
-- matches the F-6 spec; the worker passes its own value so ops
-- can tune via the worker config without a migration.
create or replace function rgaios_audit_log_prune(
  retention_days integer default 90
)
returns integer
language sql
as $$
  with deleted as (
    delete from rgaios_audit_log
     where ts < now() - make_interval(days => retention_days)
     returning 1
  )
  select count(*)::integer from deleted;
$$;

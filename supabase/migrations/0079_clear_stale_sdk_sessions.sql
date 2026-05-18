-- 0079_clear_stale_sdk_sessions.sql
-- BUG-1 bulk normalize: Anthropic Agent SDK sessions referenced by
-- rgaios_agents.sdk_session_id can be garbage-collected at the
-- provider side after quiet windows / deploys. PR #146 added a
-- read-time retry that auto-clears + retries on the first
-- "No conversation found with session ID:" miss, but pre-fix
-- agents still hold stale ids that would fail-then-self-heal
-- one chat turn at a time. Friction at scale: A reported 5x
-- manual REST PATCH workarounds in one canonical-walk session.
--
-- This migration bulk-clears every sdk_session_id to the empty
-- string. chat-sdk.ts:44 already treats both NULL and "" as
-- "cleared" on the read side, and the column was originally
-- shipped as NOT NULL DEFAULT '' (the chat-sdk.ts:44 comment
-- documents this); writing '' is the safe choice regardless of
-- the live nullability. Next chat per agent starts a fresh
-- session via the existing runOnce(undefined) path; the PR #146
-- retry stays dormant unless a re-stale repeats post-deploy.
--
-- Idempotent: the WHERE filter no-ops once everything is "".
-- The migration runner (scripts/migrate.ts) applies each file
-- exactly once via rgaios_schema_migrations PK, but the WHERE
-- also protects against manual reruns and the
-- tests/migrations/idempotency.spec.ts double-apply.
--
-- ADD-COLUMN-IF-MISSING: prior CI run (PR #147 attempt 1) failed
-- with "column sdk_session_id does not exist" on the fresh-DB
-- migrations job. The column was added ad-hoc to prod Supabase by
-- the original Agent SDK switch (commit 3054e6a) without a
-- schema-as-code migration, so a fresh apply has no column to
-- update. Add it here as a pre-step so the migration is
-- self-contained on fresh DBs AND no-ops on prod where the column
-- already exists. The DEFAULT '' matches the read-side
-- "cleared" convention at chat-sdk.ts:44.

ALTER TABLE rgaios_agents
  ADD COLUMN IF NOT EXISTS sdk_session_id text NOT NULL DEFAULT '';

UPDATE rgaios_agents
   SET sdk_session_id = ''
 WHERE sdk_session_id IS NOT NULL
   AND sdk_session_id <> '';

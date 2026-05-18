import test from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Pins the BUG-1 bulk-clear migration shape so a future edit cannot
// silently turn the safe "" write into a NULL write (the column was
// originally shipped as NOT NULL DEFAULT '' - documented at
// src/lib/agent/chat-sdk.ts:44 - and a NULL would crash the apply).
// Also pins the WHERE filter so the migration stays a no-op on
// reruns / on the tests/migrations/idempotency.spec.ts double-apply.

const MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/0079_clear_stale_sdk_sessions.sql",
);

test("0079: writes empty string, never NULL (NOT NULL column safety)", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /SET\s+sdk_session_id\s*=\s*''/i,
    "must clear to '' per chat-sdk.ts:44 convention",
  );
  assert.doesNotMatch(
    sql,
    /SET\s+sdk_session_id\s*=\s*NULL/i,
    "must not write NULL - column may be NOT NULL DEFAULT ''",
  );
});

test("0079: WHERE filter makes the UPDATE idempotent across reruns", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /WHERE[\s\S]*sdk_session_id\s+IS\s+NOT\s+NULL/i,
    "WHERE must skip already-NULL rows",
  );
  assert.match(
    sql,
    /WHERE[\s\S]*sdk_session_id\s*<>\s*''/i,
    "WHERE must skip already-cleared rows so the second apply touches zero rows",
  );
});

test("0079: targets rgaios_agents (not a typo'd table name)", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /UPDATE\s+rgaios_agents/i,
    "table must be rgaios_agents - chat-sdk.ts loads/saves sdk_session_id on this table",
  );
});

test("0079: ADD COLUMN IF NOT EXISTS makes the migration self-contained on fresh DBs", () => {
  // Column was added ad-hoc to prod Supabase by commit 3054e6a
  // (Agent SDK switch) with no schema-as-code migration. Fresh-DB
  // CI has no column, so the UPDATE alone errors with
  // "column sdk_session_id does not exist". Add it first.
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  assert.match(
    sql,
    /ALTER\s+TABLE\s+rgaios_agents[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+sdk_session_id/i,
    "must ADD COLUMN IF NOT EXISTS sdk_session_id so the migration works on fresh DBs",
  );
  assert.match(
    sql,
    /sdk_session_id\s+text\s+NOT\s+NULL\s+DEFAULT\s+''/i,
    "column type must match the chat-sdk.ts:44 NOT NULL DEFAULT '' convention",
  );
});

test("0079: ALTER precedes UPDATE so the column exists before the write", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  const alterIdx = sql.search(/ALTER\s+TABLE\s+rgaios_agents/i);
  const updateIdx = sql.search(/UPDATE\s+rgaios_agents/i);
  assert.ok(alterIdx >= 0 && updateIdx >= 0, "both statements must exist");
  assert.ok(
    alterIdx < updateIdx,
    "ALTER TABLE must come before UPDATE - otherwise the UPDATE references a column that does not exist yet on fresh DBs",
  );
});

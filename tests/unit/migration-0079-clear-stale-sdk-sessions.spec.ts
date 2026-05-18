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

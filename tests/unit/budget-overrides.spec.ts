import { test } from "node:test";
import assert from "node:assert/strict";
import { BUDGET_ROLES } from "../../src/lib/agent/budget-overrides";

/**
 * Pure-value contracts for the budget-overrides helper. Data-access
 * functions (fetch / upsert / delete) hit supabaseAdmin and live
 * behind RLS; their integration coverage lives in the e2e suite, not
 * here. This file pins the value-shape promises:
 *   - role whitelist matches the SQL CHECK constraint in 0077
 *   - role labels match the JARGON role names used by computeChatBudget
 */

test("BUDGET_ROLES list matches migration 0077 CHECK constraint", () => {
  assert.deepEqual([...BUDGET_ROLES], ["ceo", "deptHead", "specialist"]);
});

test("BUDGET_ROLES is sorted from most-authoritative to least", () => {
  const ordered = [...BUDGET_ROLES];
  assert.equal(ordered[0], "ceo");
  assert.equal(ordered[2], "specialist");
});

test("BUDGET_ROLES has no duplicates", () => {
  const set = new Set(BUDGET_ROLES);
  assert.equal(set.size, BUDGET_ROLES.length);
});

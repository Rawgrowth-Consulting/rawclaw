import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";

import {
  CHAT_BLOCKS,
  type AgentContextMode,
} from "../../src/lib/agent/context";
import CHAT_BLOCKS_CONFIG from "../../src/lib/agent/chat-blocks.config.json";
import BUDGET_POLICY_CONFIG from "../../src/lib/agent/budget-policy.config.json";

// Iter 35 guard rail. The 21-entry CHAT_BLOCKS array is the source
// of truth for what renders in the chat preamble. A future
// contributor adding a block could regress on subtle invariants -
// duplicate id, missing build, negative cost, typo in a `modes`
// entry - and the existing selector tests would pass while
// production renders garbage. These specs pin the structural
// contract so the regression shows up here first.

const VALID_MODES = new Set<AgentContextMode>([
  "chat",
  "telegram",
  "routine",
  "invoke",
]);

test("CHAT_BLOCKS: every block has a non-empty string id", () => {
  for (const block of CHAT_BLOCKS) {
    assert.equal(typeof block.id, "string", `block id must be a string`);
    assert.ok(block.id.length > 0, `block id must be non-empty`);
  }
});

test("CHAT_BLOCKS: every block id is unique", () => {
  const ids = CHAT_BLOCKS.map((b) => b.id);
  const seen = new Map<string, number>();
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  assert.deepEqual(
    dupes,
    [],
    `duplicate CHAT_BLOCKS ids found: ${JSON.stringify(dupes)}`,
  );
});

test("CHAT_BLOCKS: every block has a callable build function", () => {
  for (const block of CHAT_BLOCKS) {
    assert.equal(
      typeof block.build,
      "function",
      `block "${block.id}" missing build function`,
    );
  }
});

test("CHAT_BLOCKS: every block has a valid priority", () => {
  for (const block of CHAT_BLOCKS) {
    assert.ok(
      block.priority === "required" || block.priority === "skippable",
      `block "${block.id}" has invalid priority: ${String(block.priority)}`,
    );
  }
});

test("CHAT_BLOCKS: every block has a non-negative defaultCostTokens", () => {
  for (const block of CHAT_BLOCKS) {
    assert.equal(
      typeof block.defaultCostTokens,
      "number",
      `block "${block.id}" missing defaultCostTokens`,
    );
    assert.ok(
      Number.isFinite(block.defaultCostTokens) &&
        (block.defaultCostTokens ?? -1) >= 0,
      `block "${block.id}" has invalid defaultCostTokens: ${block.defaultCostTokens}`,
    );
  }
});

test("CHAT_BLOCKS: every modes entry (if present) is from the allowed set", () => {
  for (const block of CHAT_BLOCKS) {
    if (!block.modes) continue;
    assert.ok(
      Array.isArray(block.modes),
      `block "${block.id}" modes must be an array`,
    );
    assert.ok(
      block.modes.length > 0,
      `block "${block.id}" has empty modes array (omit field instead)`,
    );
    for (const m of block.modes) {
      assert.ok(
        VALID_MODES.has(m),
        `block "${block.id}" has invalid mode "${m}" (allowed: ${[
          ...VALID_MODES,
        ].join(", ")})`,
      );
    }
  }
});

test("CHAT_BLOCKS: registry contains the expected 21 entries (phase 2 baseline)", () => {
  // Pins the size so a stealth removal or merge accident shows up.
  // Bump intentionally when adding a new block.
  assert.equal(
    CHAT_BLOCKS.length,
    21,
    `CHAT_BLOCKS size changed to ${CHAT_BLOCKS.length}; update the baseline if intentional`,
  );
});

test("CHAT_BLOCKS config JSON: parses + has 21 entries (iter 37)", () => {
  assert.ok(
    Array.isArray(CHAT_BLOCKS_CONFIG),
    "chat-blocks.config.json must be a JSON array",
  );
  assert.equal(
    CHAT_BLOCKS_CONFIG.length,
    21,
    `JSON config size ${CHAT_BLOCKS_CONFIG.length} != 21 baseline; bump if intentional`,
  );
});

test("CHAT_BLOCKS config JSON: every entry matches CHAT_BLOCKS in order (iter 37)", () => {
  const configIds = (CHAT_BLOCKS_CONFIG as Array<{ id: string }>).map(
    (e) => e.id,
  );
  const blockIds = CHAT_BLOCKS.map((b) => b.id);
  assert.deepEqual(
    configIds,
    blockIds,
    "JSON config id order must match CHAT_BLOCKS order (composer relies on registry order)",
  );
});

test("CHAT_BLOCKS config JSON: every entry has valid required fields (iter 37)", () => {
  for (const entry of CHAT_BLOCKS_CONFIG as Array<Record<string, unknown>>) {
    assert.ok(
      typeof entry.id === "string" && entry.id.length > 0,
      `config entry missing id: ${JSON.stringify(entry)}`,
    );
    assert.ok(
      entry.priority === "required" || entry.priority === "skippable",
      `config entry "${String(entry.id)}" has invalid priority: ${String(entry.priority)}`,
    );
    assert.ok(
      typeof entry.defaultCostTokens === "number" &&
        Number.isFinite(entry.defaultCostTokens) &&
        entry.defaultCostTokens >= 0,
      `config entry "${String(entry.id)}" has invalid defaultCostTokens: ${String(entry.defaultCostTokens)}`,
    );
  }
});

test("CHAT_BLOCKS: array + each entry are Object.frozen (iter 38)", () => {
  // Iter 38 hardening: registry is built once at module load from
  // the JSON config, then frozen. Accidental .push, .splice, or
  // mutating a single entry's defaultCostTokens at runtime would
  // silently desync the selector + describer; freezing makes that
  // throw loudly under strict mode.
  assert.ok(
    Object.isFrozen(CHAT_BLOCKS),
    "CHAT_BLOCKS array must be Object.frozen",
  );
  for (const block of CHAT_BLOCKS) {
    assert.ok(
      Object.isFrozen(block),
      `CHAT_BLOCKS entry "${block.id}" must be Object.frozen`,
    );
  }
});

test("budget-policy.config.json: roleBudget tiers match defaults (iter 40)", () => {
  const rb = (BUDGET_POLICY_CONFIG as { roleBudget: Record<string, number> })
    .roleBudget;
  assert.equal(rb.ceo, 6000, "CEO tier default");
  assert.equal(rb.deptHead, 4000, "dept-head tier default");
  assert.equal(rb.specialist, 2000, "specialist tier default");
});

test("budget-policy.config.json: every tier is a positive finite number (iter 40)", () => {
  const rb = (BUDGET_POLICY_CONFIG as { roleBudget: Record<string, number> })
    .roleBudget;
  for (const [tier, value] of Object.entries(rb)) {
    assert.ok(
      typeof value === "number" && Number.isFinite(value) && value > 0,
      `tier "${tier}" must be a positive finite number, got ${String(value)}`,
    );
  }
});

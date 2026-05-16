import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";

import {
  CHAT_BLOCKS,
  type AgentContextMode,
} from "../../src/lib/agent/context";

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

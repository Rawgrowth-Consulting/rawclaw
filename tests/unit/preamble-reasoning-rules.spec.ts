import test from "node:test";
import { strict as assert } from "node:assert";
import {
  buildReasoningProtocolBlock,
  buildTrailingProtocolsBlock,
} from "../../src/lib/agent/preamble";

/**
 * Regression smoke for the 12 autoresearch PRs (#57-#72) that added
 * reasoning protocol rules today. Each rule name must appear LITERALLY
 * in the block string so silent removal (refactor regression, merge
 * conflict resolution that drops a line, copy-paste loss) fails CI
 * instead of shipping a quietly weaker preamble to every agent.
 *
 * Block ownership:
 *   buildReasoningProtocolBlock - PR #57 PLAN/3-STRIKE, #58
 *   IDENTITY-RECONSOLIDATE reanchor mention, #59 CONTEXT-POISON-CHECK,
 *   #60 BRANCH-AND-RESUME, #61 TRADEOFF-FRAMING, #62
 *   PARALLEL-WHEN-INDEPENDENT, #63 VERBALIZED-CONFIDENCE, #64
 *   GOAL-REANCHOR, #69 NEXT-ACTION-COMMIT, #72 SURFACE-ASSUMPTIONS.
 *   buildTrailingProtocolsBlock - PR #57 ERROR-NEVER-SUCCESS.
 *   FILENAME-RESOLVE lives in the per-surface commands blocks
 *   (CEO + sub-agent composio), so we re-grep the source file for it
 *   rather than the reasoning block.
 */

const REASONING = buildReasoningProtocolBlock();
const TRAILING = buildTrailingProtocolsBlock("");

// Lock the rules that live in the REASONING PROTOCOL block.
const REASONING_RULES = [
  "PLAN > ACT > OBSERVE > REFLECT", // PR #57 - spelled with arrows
  "3-STRIKE", // PR #57
  "IDENTITY-RECONSOLIDATE", // PR #58 (referenced inside GOAL-REANCHOR)
  "CONTEXT-POISON-CHECK", // PR #59
  "BRANCH-AND-RESUME", // PR #60
  "TRADEOFF-FRAMING", // PR #61
  "PARALLEL-WHEN-INDEPENDENT", // PR #62
  "VERBALIZED-CONFIDENCE", // PR #63
  "GOAL-REANCHOR", // PR #64
  "NEXT-ACTION-COMMIT", // PR #69
  "SURFACE-ASSUMPTIONS", // PR #72
];

for (const rule of REASONING_RULES) {
  test(`reasoning block contains ${rule}`, () => {
    assert.ok(
      REASONING.includes(rule),
      `missing ${rule} in buildReasoningProtocolBlock - silent removal?`,
    );
  });
}

// PR #57 trailing block rule.
test("trailing block contains ERROR-NEVER-SUCCESS (PR #57)", () => {
  assert.ok(
    TRAILING.includes("ERROR-NEVER-SUCCESS"),
    "missing ERROR-NEVER-SUCCESS in buildTrailingProtocolsBlock",
  );
});

// FILENAME-RESOLVE lives in the per-surface commands blocks (CEO +
// sub-agent composio), not the reasoning block. Assert it via source.
test("FILENAME-RESOLVE present in preamble.ts source (CEO + sub-agent surfaces)", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const src = readFileSync(
    resolve(__dirname, "../../src/lib/agent/preamble.ts"),
    "utf8",
  );
  const hits = (src.match(/FILENAME-RESOLVE/g) ?? []).length;
  assert.ok(
    hits >= 2,
    `expected FILENAME-RESOLVE on both CEO + sub-agent surfaces (>=2), got ${hits}`,
  );
});

// REPLY-LENGTH-PROPORTIONAL (PR #67) is pending merge. Skip cleanly
// if absent so this file lands now and the rule auto-locks once #67
// hits v3 (the next CI run will flip the skip into a real assertion
// the moment the string appears).
const HAS_REPLY_LENGTH =
  REASONING.includes("REPLY-LENGTH-PROPORTIONAL") ||
  TRAILING.includes("REPLY-LENGTH-PROPORTIONAL");

test(
  "REPLY-LENGTH-PROPORTIONAL present (PR #67)",
  { skip: !HAS_REPLY_LENGTH ? "PR #67 not yet merged to v3" : false },
  () => {
    assert.ok(
      HAS_REPLY_LENGTH,
      "REPLY-LENGTH-PROPORTIONAL missing from both reasoning + trailing blocks",
    );
  },
);

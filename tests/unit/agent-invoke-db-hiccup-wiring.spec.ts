import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guard rail for PR #134 (D 04:22) - the DB-hiccup retry + chain-
 * reset warning inside `loadIncomingChain` at
 * src/lib/mcp/tools/agent-invoke.ts:31-65.
 *
 * Why a regex guard and not a behavioral test: `loadIncomingChain`
 * is module-internal (not exported), and the failure mode we need
 * to pin is "a future refactor silently drops the retry / silently
 * drops the warning". The contract is shape-level - the right
 * attempt loop + the right warnings have to be present in source.
 * Same pattern as tests/unit/budget-policy-wiring.spec.ts +
 * tests/unit/chat-eager-synth-wiring.spec.ts (PR #133).
 */

const SRC = readFileSync(
  resolve(__dirname, "../../src/lib/mcp/tools/agent-invoke.ts"),
  "utf8",
);

test("agent-invoke loadIncomingChain uses a 2-attempt retry loop (PR #134)", () => {
  // The retry is the load-bearing change: a single transient Supabase
  // failure must not silently reset the delegation chain to depth=0.
  // A `for (let attempt = 1; attempt <= 2; ...)` is the canonical
  // shape; a refactor that drops the loop or shortens it to 1
  // attempt flips this red.
  assert.match(
    SRC,
    /for\s*\(\s*let\s+attempt\s*=\s*1\s*;\s*attempt\s*<=\s*2/,
    "loadIncomingChain must run a 2-attempt retry loop around the Supabase query",
  );
});

test("agent-invoke loadIncomingChain logs per-attempt failures with attempt counter", () => {
  // Each catch must emit a console.warn that includes the attempt
  // number and the caller agent id so ops can correlate transient
  // blips with chain-reset events.
  assert.match(
    SRC,
    /console\.warn\([\s\S]*?loadIncomingChain attempt \$\{attempt\}\/2 for caller \$\{callerAgentId\}/,
    "per-attempt catch must log a console.warn with attempt counter + caller id",
  );
});

test("agent-invoke loadIncomingChain logs the depth=0 fallback distinctly from no-row return", () => {
  // The "no row found" path returns depth=0 immediately and silently
  // (it's the steady-state common case for non-delegated callers).
  // The "two DB failures" path returns depth=0 + emits a separate
  // chain-reset warning so the real failure mode is observable.
  // Pin both messages so a refactor cannot accidentally swap them
  // or collapse them into a single noisy log.
  assert.match(
    SRC,
    /returning depth=0 fallback for caller \$\{callerAgentId\} after DB failures/,
    "post-retry-exhaustion path must log a distinct chain-reset warning naming the caller",
  );
});

test("agent-invoke loadIncomingChain has a no-row early-return that skips retry + warning", () => {
  // The success-no-row branch must return `{ chain: [], depth: 0 }`
  // BEFORE the retry loop wraps back around or the fallback warning
  // fires. Without this, every non-delegated agent call would log
  // a noisy chain-reset warning. Pin the early-return shape.
  assert.match(
    SRC,
    /return\s*\{\s*chain:\s*\[\]\s*,\s*depth:\s*0\s*\}\s*;[\s\S]{0,500}?\}\s*catch/,
    "no-row branch must return depth=0 inside the try (before the catch fires)",
  );
});

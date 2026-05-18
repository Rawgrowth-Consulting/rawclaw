import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * GAP-4a follow-up (2026-05-18): PR #152 patched extractThinking to scrub
 * em-dash from the pass-1 Reasoning surface, but chat/route.ts pass-2
 * (Observation) emit uses extractThinkingRaw + emits the brief verbatim.
 * R-MARTI-SCRAPE-POST-BUG9 06:38 captured the leak: "the scraper scrape
 * ran and returned exactly 5 items — BUG-9 fix confirmed".
 *
 * Pin the scrubThinkingDashes wrap at the pass-2 emit boundary. The
 * raw extraction is preserved so the db row stays uncorrupted for
 * audit-log debugging.
 */

const CHAT_ROUTE_SRC = readFileSync(
  resolve(__dirname, "../../src/app/api/agents/[id]/chat/route.ts"),
  "utf8",
);

test("chat route imports scrubThinkingDashes from thinking module", () => {
  assert.match(
    CHAT_ROUTE_SRC,
    /scrubThinkingDashes[\s\S]*?from\s+"@\/lib\/agent\/thinking"/,
    "scrubThinkingDashes must be imported alongside extractThinking",
  );
});

test("pass-2 thinking emit wraps brief in scrubThinkingDashes", () => {
  // After the pass2Thinking extract, the emit({ type: 'thinking', brief: ... })
  // must call scrubThinkingDashes on pass2Thinking.thinking so the
  // operator-visible Reasoning chip is em-dash-free.
  assert.match(
    CHAT_ROUTE_SRC,
    /pass2Thinking[\s\S]*?emit\(\{[\s\S]*?type:\s*"thinking"[\s\S]*?brief:\s*scrubThinkingDashes\(pass2Thinking\.thinking\)/,
    "pass-2 emit must wrap brief in scrubThinkingDashes(pass2Thinking.thinking)",
  );
});

test("pass-2 persistence still uses raw pass2Thinking.thinking (audit-log fidelity)", () => {
  // The db insert immediately below must NOT wrap pass2Thinking.thinking
  // in scrubThinkingDashes - the audit log should preserve what the
  // model actually composed, regardless of what the operator sees.
  assert.match(
    CHAT_ROUTE_SRC,
    /content:\s*`Thinking:\s*\$\{pass2Thinking\.thinking\}`/,
    "db insert must persist raw pass2Thinking.thinking for audit fidelity",
  );
});

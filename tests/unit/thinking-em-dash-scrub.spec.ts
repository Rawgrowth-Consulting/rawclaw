import { test } from "node:test";
import assert from "node:assert/strict";
import { extractThinking, extractThinkingRaw } from "../../src/lib/agent/thinking";

/**
 * GAP-4a (2026-05-18): the Reasoning surface renders the agent's
 * <thinking> trace verbatim. applyBrandFilter (chat/route.ts:1576)
 * catches em-dash on the visible reply but never touches the thinking
 * trace. Composition-time variance reproduced across 5+ agents this
 * session (Kasia 75% / EM 50% / others mixed). extractThinking now
 * scrubs em-dash / en-dash / minus to " - " on the thinking surface
 * post-humanize, mirroring apply-filter.ts:51's lang-agnostic
 * substitution. extractThinkingRaw stays raw for persistence.
 */

test("extractThinking scrubs em-dash from thinking trace", () => {
  const reply =
    "<thinking>Pure content judgment — I answer directly.</thinking>\nFinal: ok";
  const r = extractThinking(reply);
  // Single em-dash with surrounding spaces becomes "  -  " (double
  // space each side). Mirrors apply-filter.ts:51's substitution shape.
  assert.equal(
    r.thinking,
    "Pure content judgment  -  I answer directly.",
    "em-dash must be replaced by ' - '",
  );
  assert.doesNotMatch(r.thinking ?? "", /[—–−]/);
  assert.equal(r.visibleReply, "Final: ok");
});

test("extractThinking scrubs en-dash + minus from thinking trace", () => {
  const reply =
    "<thinking>step 1 – sourcing\nstep 2 −verify\nstep 3 — decision</thinking>\nReply.";
  const r = extractThinking(reply);
  assert.match(r.thinking ?? "", /step 1\s+-\s+sourcing/);
  assert.match(r.thinking ?? "", /step 2\s+-\s*verify/);
  assert.match(r.thinking ?? "", /step 3\s+-\s+decision/);
  assert.doesNotMatch(r.thinking ?? "", /[—–−]/);
});

test("extractThinking truncated-open-tag path also scrubs", () => {
  const reply = "Visible bit. <thinking>Reasoning — continues";
  const r = extractThinking(reply);
  assert.equal(r.visibleReply, "Visible bit.");
  assert.match(r.thinking ?? "", / - /);
  assert.doesNotMatch(r.thinking ?? "", /—/);
});

test("extractThinkingRaw keeps em-dash for persistence (raw surface)", () => {
  const reply =
    "<thinking>Pure content judgment — I answer directly.</thinking>\nFinal: ok";
  const r = extractThinkingRaw(reply);
  assert.match(
    r.thinking ?? "",
    /—/,
    "raw extractor keeps em-dash so the audit log preserves the model's exact composition",
  );
});

test("no thinking block - no regression", () => {
  const reply = "Plain reply with em - dash should not be touched here.";
  const r = extractThinking(reply);
  assert.equal(r.thinking, null);
});

test("scrub does not collapse adjacent text", () => {
  const reply = "<thinking>foo—bar—baz</thinking>\nx";
  const r = extractThinking(reply);
  assert.equal(r.thinking, "foo - bar - baz");
});

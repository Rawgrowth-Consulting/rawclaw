import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";

/**
 * HOTFIX 24 strip contract — failing until A ships the JARGON_MAP
 * extensions per B 01:16 EVIDENCE DISPATCH:
 *
 *   /\bPedro\b/g            → "" (strip — operator name leak)
 *   /shared memory/gi       → "an internal rule"
 *   /FLEX MODE/gi           → "" (strip)
 *   /system_prompt/g        → "behavior settings"
 *   /type mismatch/g        → "format issue"
 *   /command structure/g    → "request format"
 *   /Running command\.\.\./ → "Working on it..." (HOTFIX 25 spinner)
 *
 * Evidence: R-MARTI-1 v3 screenshot leaked "Pedro" 6× in reasoning
 * chip + "shared memory" + "FLEX MODE" + raw "Running command..."
 * spinner. Walks blocked at 50/100 until these tests flip green.
 *
 * Each test pins one production-observed leak. Once A ships H24,
 * the contract enforces the scrub forever.
 */

test("FLEX MODE label stripped from reasoning chip", () => {
  const out = humanizeJargon("Per FLEX MODE, fire the tool");
  assert.doesNotMatch(out, /FLEX MODE/i);
});

test("shared memory + operator name redacted together", () => {
  const out = humanizeJargon("shared memory says: do NOT reference Pedro");
  assert.doesNotMatch(out, /Pedro/);
  assert.doesNotMatch(out, /shared memory/i);
});

// H25 spinner "Running command..." → "Working on it..." lives in
// src/components/agents/AgentChatTab.tsx (fallback for unknown
// action), not in humanizeJargon — per A's 923d5c6 implementation.
// The component-level contract is asserted in the AgentChatTab
// spec, not here.

test("tool wrapper + operator name leak both scrubbed", () => {
  const out = humanizeJargon("agents_update on Pedro");
  assert.doesNotMatch(out, /agents_update/);
  assert.doesNotMatch(out, /Pedro/);
});

test("system_prompt label humanized to behavior settings", () => {
  const out = humanizeJargon("Updated my system_prompt with the new tone line");
  assert.match(out, /behavior settings/);
  assert.doesNotMatch(out, /system_prompt/);
});

test("type mismatch humanized to format issue", () => {
  const out = humanizeJargon("Failed with a type mismatch on the second try");
  assert.match(out, /format issue/);
  assert.doesNotMatch(out, /type mismatch/);
});

test("command structure humanized to request format", () => {
  const out = humanizeJargon("Hit a command structure error");
  assert.match(out, /request format/);
  assert.doesNotMatch(out, /command structure/);
});

test("Pedro as standalone name stripped", () => {
  const out = humanizeJargon("Operator asks to reference Pedro here");
  assert.doesNotMatch(out, /\bPedro\b/);
});

test("operator-allowed phrasing unchanged (no false positives)", () => {
  const clean = "Operator wants me to append the new line and ship.";
  const out = humanizeJargon(clean);
  assert.equal(out, clean);
});

test("idempotent on H24 patterns", () => {
  const noisy = "FLEX MODE: shared memory says Pedro fired agents_update";
  const once = humanizeJargon(noisy);
  const twice = humanizeJargon(once);
  assert.equal(twice, once);
});

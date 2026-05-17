import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";

/**
 * P44 regression: even after P43 collapsed "the the", the symmetric
 * "rule rule" duplicate survived. A v120 surfaced "Per the the
 * resolution rule rule" at 2026-05-17 08:25 - P43 fixed the prefix
 * half, P44 the suffix half.
 */

const CASES: Array<{ input: string; expected: string }> = [
  // The exact A v120 leak (P43 + P44 chain).
  {
    input: "Per the the resolution rule rule",
    expected: "Per the resolution rule",
  },
  // Bare suffix double.
  { input: "the rule rule", expected: "the rule" },
  // Mid-sentence.
  {
    input: "follow the rule rule then continue",
    expected: "follow the rule then continue",
  },
  // Prefix only (not affected by P44).
  { input: "rule rule applies", expected: "rule applies" },
];

for (const c of CASES) {
  test(`humanizeJargon: "${c.input}" -> "${c.expected}"`, () => {
    assert.equal(humanizeJargon(c.input), c.expected);
  });
}

/**
 * Guard: single "rule" must not be collapsed.
 */
test("single 'rule' untouched", () => {
  assert.equal(humanizeJargon("the rule"), "the rule");
  assert.equal(humanizeJargon("Per the resolution rule"), "Per the resolution rule");
});

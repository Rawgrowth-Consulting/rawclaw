import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";

/**
 * P43 regression: A v105 surfaced "Per the the resolution rule protocol".
 * P41 greedy regex caught the "rule" suffix but not the prefix doubling
 * when the suffix word was "protocol" (out of regex scope). The end-of-map
 * safety net collapses every leftover "the the" double.
 */

const CASES: Array<{ input: string; expected: string }> = [
  // The exact A v105 leak.
  {
    input: "Per the the resolution rule protocol",
    expected: "Per the resolution rule protocol",
  },
  // Bare double.
  { input: "the the rule", expected: "the rule" },
  // Capitalised first occurrence (gi flag).
  { input: "The the rule", expected: "the rule" },
  // Mid-sentence with extra words.
  {
    input: "First we follow the the rule then act.",
    expected: "First we follow the rule then act.",
  },
  // Extra whitespace between doubled "the"s collapses; trailing
  // whitespace before the next word is preserved as-is (regex only
  // owns the doubled-article span).
  { input: "the  the   rule", expected: "the   rule" },
];

for (const c of CASES) {
  test(`humanizeJargon: "${c.input}" -> "${c.expected}"`, () => {
    assert.equal(humanizeJargon(c.input), c.expected);
  });
}

/**
 * Guard: single "the" must not be collapsed.
 */
test("single 'the' untouched", () => {
  assert.equal(humanizeJargon("the rule"), "the rule");
  assert.equal(humanizeJargon("Per the resolution rule protocol"), "Per the resolution rule protocol");
});

/**
 * Guard: P41 single-collapse path still works on "rule rule" suffix
 * (this regression test re-verifies the end-of-map safety net does
 * not interact badly with the upstream FILENAME-RESOLVE pattern).
 */
test("P41 + P43 chain: 'the the FILENAME-RESOLVE rule rule' still collapses", () => {
  assert.equal(
    humanizeJargon("per the the FILENAME-RESOLVE rule rule"),
    "per the resolution rule",
  );
});

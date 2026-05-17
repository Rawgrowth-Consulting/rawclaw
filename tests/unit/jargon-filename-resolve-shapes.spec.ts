import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";

/**
 * P39 regression: FILENAME-RESOLVE / name-RESOLVE patterns must collapse
 * every surrounding "the" / "rule" wrapper into the single replacement
 * "the resolution rule", never the doubled "the the resolution rule rule"
 * surfaced in A's v78 walk on 2026-05-17 06:59.
 *
 * Pattern fix at src/lib/agent/jargon.ts:176-177 captures optional
 *   - (the\s+) prefix
 *   - (\s+rule) suffix
 * so all four input shapes flatten to the same output.
 */

const CASES: Array<{ input: string; expected: string }> = [
  // Bare token - same as before fix.
  { input: "Follow FILENAME-RESOLVE.", expected: "Follow the resolution rule." },
  { input: "Follow name-RESOLVE.", expected: "Follow the resolution rule." },
  // Article prefix only.
  { input: "Per the FILENAME-RESOLVE.", expected: "Per the resolution rule." },
  { input: "Per the name-RESOLVE.", expected: "Per the resolution rule." },
  // Capitalized article still gets captured because the (?:the\s+)?
  // group is case-insensitive (gi flag). Replacement is lowercase by
  // design - the prose surrounding it almost always uses lowercase "the".
  { input: "The FILENAME-RESOLVE rule applies.", expected: "the resolution rule applies." },
  // Both prefix + suffix - THE BUG.
  { input: "Per the FILENAME-RESOLVE rule.", expected: "Per the resolution rule." },
  { input: "Per the name-RESOLVE rule.", expected: "Per the resolution rule." },
];

for (const c of CASES) {
  test(`humanizeJargon: "${c.input}" -> "${c.expected}"`, () => {
    assert.equal(humanizeJargon(c.input), c.expected);
  });
}

test("regression: no 'the the resolution rule rule' artifact", () => {
  const bad = "the the resolution rule rule";
  for (const c of CASES) {
    assert.ok(
      !humanizeJargon(c.input).includes(bad),
      `Input "${c.input}" should NOT produce "${bad}" - got "${humanizeJargon(c.input)}".`,
    );
  }
});

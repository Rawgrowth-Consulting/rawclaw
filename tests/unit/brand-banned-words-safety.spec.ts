import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBrandVoice } from "../../src/lib/brand/runtime-filter";
import { BANNED_WORDS } from "../../src/lib/brand/tokens";

// Regression net: every one of the 11 frozen banned words (AGENTS.md §brand)
// must be flagged AND stripped from operator-facing copy by the runtime
// filter. If anyone silently drops a word from BANNED_WORDS / REPLACEMENTS,
// or weakens the regex, the matching row below fails CI.

// Representative operator-facing strings - the kind of copy a Department
// Head MCP tool could try to ship via telegram_reply / slack_post_message.
const SAMPLES: Record<(typeof BANNED_WORDS)[number], string> = {
  "game-changer": "Honestly, this rollout is a game-changer for the team.",
  unlock: "Click here to unlock the next stage of the funnel.",
  leverage: "We can leverage the new pipeline for ops.",
  utilize: "Operators should utilize the dashboard daily.",
  "deep dive": "Let's schedule a deep dive on Q3 numbers.",
  revolutionary: "The revolutionary workflow ships Monday.",
  "cutting-edge": "Our cutting-edge stack lands the demo.",
  synergy: "The synergy between sales and ops is unmatched.",
  streamline: "We streamline onboarding to under five minutes.",
  empower: "These tools empower the founder directly.",
  certainly: "Certainly, that report is ready for review.",
};

for (const word of BANNED_WORDS) {
  test(`runtime filter strips banned word: ${word}`, () => {
    const sample = SAMPLES[word];
    const r = checkBrandVoice(sample);
    assert.equal(r.ok, false, `expected "${word}" to be flagged in: ${sample}`);
    if (r.ok) return;
    assert.ok(
      r.hits.includes(word),
      `hits should contain "${word}", got ${JSON.stringify(r.hits)}`,
    );
    const re = new RegExp(`\\b${word.replace(/[-\s]/g, "[-\\s]")}\\b`, "i");
    assert.doesNotMatch(
      r.rewritten,
      re,
      `rewritten still contains "${word}": ${r.rewritten}`,
    );
  });
}

test("uppercase variants also stripped", () => {
  const r = checkBrandVoice("CERTAINLY we can Leverage this Synergy.");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.doesNotMatch(r.rewritten, /certainly/i);
  assert.doesNotMatch(r.rewritten, /leverage/i);
  assert.doesNotMatch(r.rewritten, /synergy/i);
});

test("clean operator copy passes through unchanged", () => {
  const clean =
    "We shipped the migration, ran the smoke suite, and notified the operator.";
  const r = checkBrandVoice(clean);
  assert.equal(r.ok, true);
});

test("all 11 banned words present in one string are all flagged", () => {
  const kitchenSink =
    "Certainly, this revolutionary cutting-edge game-changer will " +
    "unlock synergy, leverage utilize signals, deep dive into KPIs, " +
    "streamline ops, and empower the operator.";
  const r = checkBrandVoice(kitchenSink);
  assert.equal(r.ok, false);
  if (r.ok) return;
  for (const word of BANNED_WORDS) {
    assert.ok(
      r.hits.includes(word),
      `expected "${word}" in hits, got ${JSON.stringify(r.hits)}`,
    );
  }
});

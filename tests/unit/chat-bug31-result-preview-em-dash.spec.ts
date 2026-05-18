import test from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";
import { scrubThinkingDashes } from "../../src/lib/agent/thinking";

// BUG-31 (D 2026-05-18 R-MARTI-CANONICAL Kasia keyframe walk): the
// commands_executed SSE event in src/app/api/agents/[id]/chat/route.ts
// scrubbed results[].summary via scrubThinkingDashes(humanizeJargon(...))
// post-BUG-28 (PR #160) but left results[].detail.result_preview raw.
// result_preview ships tool output (apify scrape summaries etc) and the
// Kasia walk surfaced an em-dash leak: "inside it - everything else"
// where the source was an em-dash in the apify result_preview shipped
// to the operator card unscrubbed.
//
// Fix: extend the commands_executed branch of emit() to also scrub
// detail.result_preview the same way summary is scrubbed.
//
// These tests pin the contract: the result_preview field must lose
// em/en/minus dashes the same way summary does.

test("result_preview em-dash strip", () => {
  const preview =
    "filtering to the genuine last-10-days window, only 3 reels are actually dated inside it — everything else is April/March.";
  const out = scrubThinkingDashes(humanizeJargon(preview));
  assert.doesNotMatch(out, /—|–|−/);
  assert.match(out, /inside it - everything else/);
});

test("result_preview en-dash inside date range", () => {
  const preview = "Reels by comments, May 8–18, 2026";
  const out = scrubThinkingDashes(humanizeJargon(preview));
  assert.doesNotMatch(out, /—|–|−/);
  assert.match(out, /May 8 - 18, 2026/);
});

test("result_preview composition with jargon scrub", () => {
  const preview =
    "operator delegated to Marta — apify scrape returned 3/10 inside the window";
  const out = scrubThinkingDashes(humanizeJargon(preview));
  assert.doesNotMatch(out, /—|–|−/);
  assert.match(out, /user delegated to Marta - /);
});

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guard rail for PR #127 (D TICK-48) - the BUG-9 eager-synth block
 * in src/app/api/agents/[id]/chat/route.ts.
 *
 * Why a regex guard and not a behavioral test: the eager-synth lives
 * inline in the chat route handler, between the pass-1 ext catch and
 * the pass-2 conditional. Exercising it end-to-end means standing up
 * the entire chat surface (auth, SSE, persistence, Composio, Apify)
 * which is out of scope for unit tests. The risk we actually need to
 * cover is "a future refactor silently drops the block" - exactly
 * the regression class that the budget-policy-wiring.spec.ts pattern
 * was designed for. We pin the call-site contract via grep on the
 * route source so the layered BUG-9 defense (PRs #120 + #124 + #126
 * + #127) cannot quietly lose its pre-pass-2 component.
 */

const CHAT_ROUTE_SRC = readFileSync(
  resolve(__dirname, "../../src/app/api/agents/[id]/chat/route.ts"),
  "utf8",
);

test("chat route lifts apify_top_reels_from_file result_preview into preFilterText (PR #127 TICK-48)", () => {
  // Anchored: tool slug + result_preview field + assignment to
  // preFilterText must all coexist in the route. A refactor that
  // renames the variable OR drops the lift entirely flips this red.
  assert.match(
    CHAT_ROUTE_SRC,
    /apify_top_reels_from_file/,
    "chat route must reference the apify_top_reels_from_file slug",
  );
  assert.match(
    CHAT_ROUTE_SRC,
    /result_preview/,
    "chat route must read detail.result_preview from the preset result",
  );
  assert.match(
    CHAT_ROUTE_SRC,
    /preFilterText\s*=\s*presetText/,
    "chat route must lift result_preview into preFilterText pre-pass-2",
  );
});

test("eager-synth gates on r.ok before lifting (no failed-tool lift)", () => {
  // The find() in PR #127 narrows on r.ok so a failed preset call
  // does not poison preFilterText with an error summary. Pin that
  // shape - a refactor that drops the ok-check would surface tool
  // errors as the operator-visible reply.
  assert.match(
    CHAT_ROUTE_SRC,
    /commandResults\.find\(\s*\([\s\S]*?r\.ok[\s\S]*?apify_top_reels_from_file/,
    "eager-synth find() must require r.ok in addition to the slug match",
  );
});

test("eager-synth lift is gated on non-empty string presetText", () => {
  // Defense in depth: typeof + length guards prevent lifting an
  // undefined / empty string when the preset returned ok but had no
  // result_preview payload (theoretical, shouldn't happen, but the
  // guard keeps the block harmless).
  assert.match(
    CHAT_ROUTE_SRC,
    /typeof presetText === "string"[\s\S]*?presetText\.length > 0/,
    "eager-synth lift must guard on typeof+length before assigning",
  );
});

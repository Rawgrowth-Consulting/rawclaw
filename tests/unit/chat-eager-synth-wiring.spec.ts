import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guard rail for the BUG-9 eager-synth block in
 * src/app/api/agents/[id]/chat/route.ts. Originally pinned to
 * apify_top_reels_from_file (PR #127 / D TICK-48) as a narrow
 * defense-in-depth for the canonical preset. Generalised on
 * 2026-05-18 to lift result_preview from any tool that exposes
 * one, after BUG-9 reproduced on (a) free-form Apify scrapes
 * (R-MARTI-SCRAPE-RETEST 05:05) and (b) composio_use_tool chains
 * post-discovery (R-COMPOSIO-1 05:41).
 *
 * Why a regex guard and not a behavioral test: the eager-synth
 * lives inline in the chat route handler between the pass-1 ext
 * catch and the pass-2 conditional. Exercising end-to-end would
 * stand up auth + SSE + persistence + Composio + Apify, out of
 * scope for unit tests. The risk we cover is "a future refactor
 * silently drops the block or re-narrows the find()" - which
 * would silently re-open BUG-9 for the 7 Apify tools + composio
 * paths the generalisation now defends.
 */

const CHAT_ROUTE_SRC = readFileSync(
  resolve(__dirname, "../../src/app/api/agents/[id]/chat/route.ts"),
  "utf8",
);

test("eager-synth lifts result_preview from any tool into preFilterText (post 2026-05-18 generalisation)", () => {
  assert.match(
    CHAT_ROUTE_SRC,
    /result_preview/,
    "chat route must read detail.result_preview from a preset result",
  );
  assert.match(
    CHAT_ROUTE_SRC,
    /preFilterText\s*=\s*presetText/,
    "chat route must lift result_preview into preFilterText pre-pass-2",
  );
});

test("eager-synth find() is generalised, not pinned to a specific tool slug", () => {
  // After 2026-05-18: the find() must not be hardcoded to
  // apify_top_reels_from_file or any other single tool name. The
  // BUG-9 silent-stuck reproduces across Apify + composio_use_tool
  // chains; pinning to one slug re-opens the bug class.
  assert.doesNotMatch(
    CHAT_ROUTE_SRC,
    /commandResults\.find\([\s\S]*?===\s*"apify_top_reels_from_file"/,
    "find() must not be hardcoded to apify_top_reels_from_file - 7 other Apify tools + composio paths must be covered",
  );
});

test("eager-synth gates on r.ok before lifting (no failed-tool lift)", () => {
  // A failed preset call must NOT poison preFilterText with an
  // error summary. Pin the ok-gate.
  assert.match(
    CHAT_ROUTE_SRC,
    /commandResults\.find\(\s*\([\s\S]*?r\.ok/,
    "eager-synth find() must require r.ok",
  );
});

test("eager-synth lift is gated on non-empty string presetText", () => {
  // Defense in depth: typeof + length guards prevent lifting an
  // undefined / empty string when a tool returned ok but no
  // result_preview payload.
  assert.match(
    CHAT_ROUTE_SRC,
    /typeof presetText === "string"[\s\S]*?presetText\.length > 0/,
    "eager-synth lift must guard on typeof+length before assigning",
  );
});

test("eager-synth find() also gates on non-empty result_preview string inline", () => {
  // The generalised find() requires result_preview to be a
  // non-empty string at the find() level too - otherwise the very
  // first ok tool without a result_preview wins the find() and
  // presetText comes back undefined, defeating the lift even when
  // a LATER ok tool DOES have a result_preview to use.
  assert.match(
    CHAT_ROUTE_SRC,
    /typeof\s*\([\s\S]*?result_preview[\s\S]*?\)\s*\?[\s\S]*?===\s*"string"/,
    "find() must require result_preview to be a string so a later ok tool with a preview is not pre-empted",
  );
});

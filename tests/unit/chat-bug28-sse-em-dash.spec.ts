import test from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";
import { scrubThinkingDashes } from "../../src/lib/agent/thinking";

// BUG-28 (D 2026-05-18 R-ORCH-1 walk 12:06): the SSE emit chokepoint in
// src/app/api/agents/[id]/chat/route.ts applied humanizeJargon to
// OPERATOR_FACING_STRING_FIELDS + commands_executed.results.summary
// but never em-dash-scrubbed those surfaces. A delegated Marta summary
// surfaced 7 em-dashes verbatim to the operator. Fix: compose
// scrubThinkingDashes(humanizeJargon(text)) at both spots so the SSE
// chokepoint matches the apply-filter.ts brand-voice guarantee.
//
// These tests pin the composition contract: the pair must strip both
// jargon AND em/en/minus dashes.

test("scrubThinkingDashes strips em-dash to hyphen-space", () => {
  assert.equal(
    scrubThinkingDashes("isn't in my direct reach — it sits with Ania"),
    "isn't in my direct reach - it sits with Ania",
  );
});

test("scrubThinkingDashes strips en-dash inside dates", () => {
  assert.equal(
    scrubThinkingDashes("DM Pipeline — May 12–18, 2026"),
    "DM Pipeline - May 12 - 18, 2026",
  );
});

test("composition order: jargon scrub does not undo dash strip", () => {
  const raw = "operator delegated to Marta — and the agent_invoke fired";
  const scrubbed = scrubThinkingDashes(humanizeJargon(raw));
  assert.match(scrubbed, /user delegated to Marta - /);
  assert.doesNotMatch(scrubbed, /—|–|−/);
});

test("commands_executed.summary shape stays clean end-to-end", () => {
  const summary =
    "Marta delivered: **DM Pipeline — May 12–18, 2026** ⚠️ Data unavailable from this surface. The Instagram DM pipeline data isn't in my direct reach — it sits with the sales/closer agent (Ania)";
  const out = scrubThinkingDashes(humanizeJargon(summary));
  assert.doesNotMatch(out, /—|–|−/);
});

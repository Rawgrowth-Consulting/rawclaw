import test from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// We assert on the source of preamble.ts rather than calling
// buildAgentChatPreamble - the function hits Supabase + needs an org/agent
// context. The preamble strings are static literals in the source file,
// which is what actually ships to the model.
const PREAMBLE_SRC = readFileSync(
  resolve(__dirname, "../../src/lib/agent/preamble.ts"),
  "utf8",
);

test("preamble contains NO-RETRY-NARRATION rule (GAP #5)", () => {
  // Single source of truth lives in buildTrailingProtocolsBlock under
  // "═══ RETRY-DISCIPLINE (all agents) ═══". The trailing block always
  // appends last, so the rule is visible to CEO + sub-agent surfaces
  // without per-block duplication (which previously got buried mid-preamble).
  const occurrences = (PREAMBLE_SRC.match(/NO-RETRY-NARRATION:/g) ?? []).length;
  assert.equal(
    occurrences,
    1,
    `expected exactly ONE NO-RETRY-NARRATION rule (consolidated in trailing block), got ${occurrences}`,
  );
  assert.match(
    PREAMBLE_SRC,
    /RETRY-DISCIPLINE \(all agents\)[\s\S]*NO-RETRY-NARRATION/,
    "NO-RETRY-NARRATION must live inside the RETRY-DISCIPLINE trailing section",
  );
});

test("NO-RETRY-NARRATION rule requires run_id grounding", () => {
  // The rule must point the model at the real source of truth - run_ids
  // visible in YOUR RECENT REASONING / RECENT SIGNALS & METRICS (which
  // come from rgaios_routine_runs). Otherwise it's just words.
  assert.match(
    PREAMBLE_SRC,
    /NO-RETRY-NARRATION[^\n]*run_id/,
    "NO-RETRY-NARRATION must explicitly require citing a run_id",
  );
  assert.match(
    PREAMBLE_SRC,
    /NO-RETRY-NARRATION[^\n]*(RECENT REASONING|RECENT SIGNALS)/,
    "NO-RETRY-NARRATION must point at the visible RECENT block as the source",
  );
});

test("NO-RETRY-NARRATION rule catches the Kasia 'previous batches failed' phrasing", () => {
  // Live failure mode from Marti Loom screenshot: agent claimed
  // 'previous batches failed' when nothing ran. Rule text must name
  // that exact retry/escalation pattern.
  assert.match(
    PREAMBLE_SRC,
    /NO-RETRY-NARRATION[^\n]*previous attempts failed/,
    "NO-RETRY-NARRATION must call out 'previous attempts failed' phrasing",
  );
  assert.match(
    PREAMBLE_SRC,
    /NO-RETRY-NARRATION[^\n]*retrying/,
    "NO-RETRY-NARRATION must call out 'retrying' phrasing",
  );
});

test("SAY-IT-MEANS-DO-IT rule is still present (no regression)", () => {
  const occurrences =
    (PREAMBLE_SRC.match(/SAY-IT-MEANS-DO-IT:/g) ?? []).length;
  assert.ok(
    occurrences >= 2,
    `SAY-IT-MEANS-DO-IT must remain in both surfaces (>=2), got ${occurrences}`,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseAuditCallReply } from "../../src/lib/audit-call/extract";

/**
 * Unit tests for the audit-call paste-flow parser. We test
 * `parseAuditCallReply` directly because it carries the only non-trivial
 * logic - `extractAuditCall` is a thin wrapper around chatComplete and
 * mocking that ESM named export is brittle. The integration-level
 * coverage (POST 401 unauth, 200 with auth) lives in the Playwright
 * spec at tests/audit-call.spec.ts.
 */

test("parseAuditCallReply: clean JSON produces the full plan", () => {
  const r = parseAuditCallReply(
    JSON.stringify({
      companySummary:
        "Acme runs a niche B2B coaching practice for solo accountants.",
      painPoints: ["Lead flow is inconsistent", "No follow-up cadence"],
      gaps: ["No SDR coverage", "No content engine"],
      suggestedAgents: [
        {
          role: "SDR",
          why: "Owns outbound + cadence to fix the inconsistent lead flow.",
          starterFiles: ["8-step-cadence.md"],
        },
      ],
    }),
  );
  assert.equal(r._error, undefined);
  assert.match(r.companySummary, /Acme/);
  assert.deepEqual(r.painPoints, [
    "Lead flow is inconsistent",
    "No follow-up cadence",
  ]);
  assert.equal(r.suggestedAgents.length, 1);
  assert.equal(r.suggestedAgents[0].role, "SDR");
  assert.deepEqual(r.suggestedAgents[0].starterFiles, ["8-step-cadence.md"]);
});

test("parseAuditCallReply: markdown fences are stripped", () => {
  const r = parseAuditCallReply(
    "```json\n" +
      JSON.stringify({
        companySummary: "fenced reply works",
        painPoints: [],
        gaps: [],
        suggestedAgents: [],
      }) +
      "\n```",
  );
  assert.equal(r._error, undefined);
  assert.equal(r.companySummary, "fenced reply works");
});

test("parseAuditCallReply: JSON embedded in prose is extracted", () => {
  const r = parseAuditCallReply(
    'Here is the JSON: {"companySummary":"embedded","painPoints":[],"gaps":[],"suggestedAgents":[]} - thanks!',
  );
  assert.equal(r._error, undefined);
  assert.equal(r.companySummary, "embedded");
});

test("parseAuditCallReply: garbage prose returns graceful _error", () => {
  const r = parseAuditCallReply("I'm sorry, I can't help with that.");
  assert.ok(r._error, "expected an _error");
  assert.equal(r.companySummary, "");
  assert.deepEqual(r.suggestedAgents, []);
});

test("parseAuditCallReply: empty reply returns 'empty model reply'", () => {
  const r = parseAuditCallReply("");
  assert.equal(r._error, "empty model reply");
});

test("parseAuditCallReply: wrong shape (array) returns _error", () => {
  const r = parseAuditCallReply("[1,2,3]");
  assert.ok(r._error, "expected an _error for array reply");
});

test("parseAuditCallReply: clamps lists to 5 items and 200 chars", () => {
  const r = parseAuditCallReply(
    JSON.stringify({
      companySummary: "x".repeat(900),
      painPoints: ["a", "b", "c", "d", "e", "f", "g"],
      gaps: ["x".repeat(300)],
      suggestedAgents: [],
    }),
  );
  assert.equal(r.painPoints.length, 5);
  assert.equal(r.gaps[0].length, 200);
  // companySummary capped at 600 chars.
  assert.equal(r.companySummary.length, 600);
});

test("parseAuditCallReply: clamps suggestedAgents to 6 entries + drops bad rows", () => {
  const agents: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 9; i++) {
    agents.push({ role: `R${i}`, why: "x", starterFiles: [] });
  }
  // Insert a bad row in the middle: missing role -> should be skipped.
  agents.splice(3, 0, { why: "no role", starterFiles: [] });
  const r = parseAuditCallReply(
    JSON.stringify({
      companySummary: "ok",
      painPoints: [],
      gaps: [],
      suggestedAgents: agents,
    }),
  );
  assert.equal(r.suggestedAgents.length, 6);
  // The bad row was skipped, so the first 6 valid roles are R0..R5.
  assert.deepEqual(
    r.suggestedAgents.map((a) => a.role),
    ["R0", "R1", "R2", "R3", "R4", "R5"],
  );
});

test("parseAuditCallReply: clamps starterFiles to 3 entries per agent", () => {
  const r = parseAuditCallReply(
    JSON.stringify({
      companySummary: "ok",
      painPoints: [],
      gaps: [],
      suggestedAgents: [
        {
          role: "Copywriter",
          why: "many files",
          starterFiles: ["a.md", "b.md", "c.md", "d.md", "e.md"],
        },
      ],
    }),
  );
  assert.equal(r.suggestedAgents[0].starterFiles.length, 3);
});

test("parseAuditCallReply: skips non-string entries silently", () => {
  const r = parseAuditCallReply(
    JSON.stringify({
      companySummary: "ok",
      painPoints: ["valid", 42, null, "another"],
      gaps: [],
      suggestedAgents: [],
    }),
  );
  assert.deepEqual(r.painPoints, ["valid", "another"]);
});

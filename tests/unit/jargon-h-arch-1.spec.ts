import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";

/**
 * HOTFIX H-ARCH-1 (2026-05-17, B 02:04 architectural review):
 * v6 R-MARTI-CANONICAL walk leaked filenames + cross-agent storage
 * refs + raw "tool errored" / "Tool failed" jargon into operator
 * reply. Negative preamble rules now block emission upstream; this
 * pins the jargon-layer safety net for any phrase that slips past.
 */

test("scrape tool errored rewritten", () => {
  assert.equal(
    humanizeJargon("The scrape tool errored - file not found."),
    "The scrape action failed - file not found.",
  );
});

test("Tool failed rewritten", () => {
  assert.equal(
    humanizeJargon("Tool failed on the second attempt."),
    "Action failed on the second attempt.",
  );
});

test("internal config filenames redacted", () => {
  assert.doesNotMatch(
    humanizeJargon("scan_agent.yaml, scan__CLAUDE.md, CLAUDE.md - none match"),
    /\.yaml|\.md/i,
  );
});

test("Per an internal rule rewritten", () => {
  assert.equal(
    humanizeJargon("Per an internal rule the list lives with Kasia."),
    "Per setup the list lives with Kasia.",
  );
});

test("Kasia's tasks rewritten (H-ARCH-2 collapsed to Kasia)", () => {
  // H-ARCH-2 supersedes: storage-suffix dropped entirely so
  // the operator just sees the peer's name, never the routing.
  assert.equal(
    humanizeJargon("Pull it from Kasia's tasks."),
    "Pull it from Kasia.",
  );
});

test("shared memory → shared notes (H-ARCH-1 override of H24)", () => {
  assert.equal(humanizeJargon("per shared memory"), "per shared notes");
});

test("compound v6 leak fully scrubbed", () => {
  const raw =
    "Tool failed because Per an internal rule the scan_agent.yaml is in Kasia's tasks per shared memory.";
  const out = humanizeJargon(raw);
  assert.doesNotMatch(out, /Tool failed/);
  assert.doesNotMatch(out, /internal rule/);
  assert.doesNotMatch(out, /\.yaml/);
  assert.doesNotMatch(out, /Kasia's (?:tasks|files|folder|notes|data)/);
  assert.doesNotMatch(out, /shared memory/);
});

test("idempotent on H-ARCH-1 patterns", () => {
  const noisy =
    "Tool failed - scan_agent.yaml in Kasia's tasks per an internal rule from shared memory";
  const once = humanizeJargon(noisy);
  const twice = humanizeJargon(once);
  assert.equal(twice, once);
});

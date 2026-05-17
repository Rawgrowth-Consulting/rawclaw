import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";

/**
 * HOTFIX H-ARCH-2 (2026-05-17, R-MARTI-CANONICAL v7 review):
 * v7 walk hit 80/100. Two micro-leaks remained:
 *   - "Kasia's files" / "Kasia's folder" not covered by H-ARCH-1
 *     regex (which only matched "Kasia's tasks").
 *   - 3x "internal config" repeat when multiple internal filenames
 *     were listed in a single sentence and all redacted to the same
 *     string. Reads like noise to the operator.
 */

test("Kasia's files rewritten", () => {
  assert.equal(humanizeJargon("might be in Kasia's files"), "might be in Kasia");
});

test("Kasia's folder rewritten", () => {
  assert.equal(humanizeJargon("look in Kasia's folder"), "look in Kasia");
});

test("Kasia's notes rewritten", () => {
  assert.equal(humanizeJargon("pull from Kasia's notes"), "pull from Kasia");
});

test("Atlas's files rewritten", () => {
  assert.equal(humanizeJargon("check Atlas's files"), "check Atlas");
});

test("Zosia's folder rewritten", () => {
  assert.equal(humanizeJargon("over in Zosia's folder"), "over in Zosia");
});

test("consecutive internal-config repeats collapsed", () => {
  assert.equal(
    humanizeJargon("scan_agent.yaml, scan__CLAUDE.md, CLAUDE.md are listed"),
    "internal config are listed",
  );
});

test("single internal-config preserved", () => {
  assert.equal(
    humanizeJargon("scan_agent.yaml is here"),
    "internal config is here",
  );
});

test("H-ARCH-2b: file-based tool → file-based scrape", () => {
  assert.equal(
    humanizeJargon("The file-based tool didn't find it"),
    "The file-based scrape didn't find it",
  );
});

test("H-ARCH-2b: actual file names → my files", () => {
  assert.equal(
    humanizeJargon("check my actual file names first"),
    "check my my files first",
  );
});

test("H-ARCH-2b: the right filename → the right one", () => {
  assert.equal(
    humanizeJargon("find the right filename to scrape"),
    "find the right one to scrape",
  );
});

test("idempotent on H-ARCH-2 patterns", () => {
  const noisy =
    "Kasia's files have scan_agent.yaml, scan__CLAUDE.md, CLAUDE.md attached";
  const once = humanizeJargon(noisy);
  const twice = humanizeJargon(once);
  assert.equal(twice, once);
});

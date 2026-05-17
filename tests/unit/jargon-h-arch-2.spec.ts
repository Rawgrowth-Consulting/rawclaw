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

test("H-ARCH-2b/f: 'my actual file names' → 'my file list' (no double-my)", () => {
  // H-ARCH-2f (C 02:37 BUG P1): previous mapping created "my my files".
  assert.equal(
    humanizeJargon("check my actual file names first"),
    "check my file list first",
  );
});

test("H-ARCH-2f: 'the actual file names' → 'the file list'", () => {
  assert.equal(
    humanizeJargon("look up the actual file names"),
    "look up the file list",
  );
});

test("H-ARCH-2f: bare 'actual file names' → 'the file list'", () => {
  assert.equal(
    humanizeJargon("verify actual file names"),
    "verify the file list",
  );
});

test("H-ARCH-2b: the right filename → the right one", () => {
  assert.equal(
    humanizeJargon("find the right filename to scrape"),
    "find the right one to scrape",
  );
});

test("H-ARCH-2c: the actual filename → my files", () => {
  assert.equal(
    humanizeJargon("find the actual filename to retry"),
    "find my files to retry",
  );
});

test("H-ARCH-2c: the exact filename → the name", () => {
  assert.equal(
    humanizeJargon("grab the exact filename, then re-run"),
    "grab the name, then re-run",
  );
});

test("H-ARCH-2c: bare filename → name", () => {
  assert.equal(humanizeJargon("the filename was wrong"), "the name was wrong");
});

test("H-ARCH-2d: file lookup failed → file search came up empty", () => {
  assert.equal(
    humanizeJargon("The file lookup failed - retrying"),
    "The file search came up empty - retrying",
  );
});

test("H-ARCH-2d: file fetch missed → file search came up empty", () => {
  assert.equal(
    humanizeJargon("The file fetch missed - checking again"),
    "The file search came up empty - checking again",
  );
});

test("H-ARCH-2d: attached file name → attached file", () => {
  assert.equal(
    humanizeJargon("didn't match any attached file name"),
    "didn't match any attached file",
  );
});

test("H-ARCH-2g: 'her tasks' → 'their notes'", () => {
  assert.equal(
    humanizeJargon("last I logged it was in her tasks"),
    "last I logged it was in their notes",
  );
});

test("H-ARCH-2g: 'his folder' → 'their notes'", () => {
  assert.equal(humanizeJargon("over in his folder"), "over in their notes");
});

test("H-ARCH-2g: 'their files' → 'their notes'", () => {
  assert.equal(humanizeJargon("check their files"), "check their notes");
});

test("idempotent on H-ARCH-2 patterns", () => {
  const noisy =
    "Kasia's files have scan_agent.yaml, scan__CLAUDE.md, CLAUDE.md attached";
  const once = humanizeJargon(noisy);
  const twice = humanizeJargon(once);
  assert.equal(twice, once);
});

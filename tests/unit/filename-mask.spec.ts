import { test } from "node:test";
import assert from "node:assert/strict";
import { maskFilenames, unmaskIndex } from "../../src/lib/util/filename-mask";

test("maskFilenames: empty array = empty string", () => {
  assert.equal(maskFilenames([]), "");
});

test("maskFilenames: emits 1-based [N] indices joined by ', '", () => {
  const files = [
    { name: "creator-list.csv" },
    { name: "brand-voice.md" },
    { name: "Q3-plan.pdf" },
  ];
  assert.equal(maskFilenames(files), "[1], [2], [3]");
});

test("unmaskIndex: round-trips a valid index", () => {
  const files = [{ name: "a.csv" }, { name: "b.md" }, { name: "c.pdf" }];
  assert.equal(unmaskIndex("[2]", files), "b.md");
});

test("unmaskIndex: out-of-range returns null", () => {
  const files = [{ name: "a.csv" }];
  assert.equal(unmaskIndex("[2]", files), null);
  assert.equal(unmaskIndex("[0]", files), null);
});

test("unmaskIndex: malformed input returns null", () => {
  const files = [{ name: "a.csv" }];
  assert.equal(unmaskIndex("2", files), null);
  assert.equal(unmaskIndex("[abc]", files), null);
  assert.equal(unmaskIndex("", files), null);
});

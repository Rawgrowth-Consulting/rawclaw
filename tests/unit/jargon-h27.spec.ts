import test from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";

test("H27: Pedro full name stripped", () => {
  assert.equal(humanizeJargon("Pedro wants this done"), " wants this done");
});

test("H27: Pedro possessive stripped", () => {
  assert.equal(humanizeJargon("Pedro's account is admin"), " account is admin");
});

test("H27: 'wrong tool name' rewritten", () => {
  assert.equal(
    humanizeJargon("Previous turn I used the wrong tool name."),
    "Previous turn I used the wrong action name.",
  );
});

test("H27: 'canonical args' rewritten", () => {
  assert.equal(
    humanizeJargon("Firing it now with the canonical args."),
    "Firing it now with the canonical inputs.",
  );
});

test("H27: bare 'tool name' rewritten", () => {
  assert.equal(humanizeJargon("the tool name was wrong"), "the action name was wrong");
});

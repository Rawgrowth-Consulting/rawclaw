import test from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";

test("GAP-X: 'An operator needs to review' -> 'A user needs to review'", () => {
  assert.equal(
    humanizeJargon("An operator needs to review"),
    "A user needs to review",
  );
});

test("GAP-X: lowercase 'an operator' -> 'a user'", () => {
  assert.equal(
    humanizeJargon("Ask an operator for help"),
    "Ask a user for help",
  );
});

test("GAP-X: bare 'operator' still -> 'user'", () => {
  assert.equal(
    humanizeJargon("operator override required"),
    "user override required",
  );
});

test("GAP-X: 'the operator' still -> 'the user'", () => {
  assert.equal(
    humanizeJargon("ping the operator first"),
    "ping the user first",
  );
});

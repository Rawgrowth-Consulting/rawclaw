import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actorPathOf,
  coerceToString,
  isApifyOk,
  parsePostTime,
} from "../../src/lib/mcp/tools/apify-helpers";

/**
 * Helpers extracted from apify.ts. Each contract covers behavior
 * the 5+ original inline definitions were silently relying on -
 * pin it so a future edit can't drift one without breaking CI.
 */

test("coerceToString: string passthrough", () => {
  assert.equal(coerceToString("hi"), "hi");
});

test("coerceToString: null + undefined yield empty string", () => {
  assert.equal(coerceToString(null), "");
  assert.equal(coerceToString(undefined), "");
});

test("coerceToString: numbers + booleans stringify", () => {
  assert.equal(coerceToString(42), "42");
  assert.equal(coerceToString(true), "true");
  assert.equal(coerceToString(false), "false");
});

test("coerceToString: object stringifies via String()", () => {
  assert.equal(coerceToString({ a: 1 }), "[object Object]");
});

test("actorPathOf: rewrites first slash to tilde", () => {
  assert.equal(actorPathOf("apify/instagram-scraper"), "apify~instagram-scraper");
});

test("actorPathOf: leaves dash-only ids alone", () => {
  assert.equal(actorPathOf("my-actor"), "my-actor");
});

test("actorPathOf: only rewrites FIRST slash (matches original .replace string form)", () => {
  // The original inline `.replace("/", "~")` form rewrites only the
  // first occurrence. Helper preserves that behaviour exactly.
  assert.equal(actorPathOf("a/b/c"), "a~b/c");
});

test("isApifyOk: 200 + 201 = true", () => {
  assert.equal(isApifyOk(200), true);
  assert.equal(isApifyOk(201), true);
});

test("isApifyOk: every other status = false", () => {
  assert.equal(isApifyOk(204), false);
  assert.equal(isApifyOk(400), false);
  assert.equal(isApifyOk(404), false);
  assert.equal(isApifyOk(500), false);
  assert.equal(isApifyOk(0), false);
});

test("parsePostTime: numeric ms timestamp passes through", () => {
  const ms = 1715900000000; // 2024-05-17
  assert.equal(parsePostTime({ timestamp: ms }), ms);
});

test("parsePostTime: numeric epoch-seconds scaled to ms", () => {
  const s = 1715900000;
  assert.equal(parsePostTime({ timestamp: s }), s * 1000);
});

test("parsePostTime: ISO string parses to ms", () => {
  assert.equal(
    parsePostTime({ takenAt: "2024-05-17T00:00:00Z" }),
    Date.parse("2024-05-17T00:00:00Z"),
  );
});

test("parsePostTime: walks fallback keys in priority order", () => {
  // timestamp present in numeric form wins over later string keys.
  const ms = 1715900000000;
  assert.equal(
    parsePostTime({ timestamp: ms, takenAt: "1970-01-01" }),
    ms,
  );
  // Fall back when first key is absent.
  assert.equal(
    parsePostTime({ takenAtTimestamp: ms }),
    ms,
  );
});

test("parsePostTime: zero on empty / unknown input", () => {
  assert.equal(parsePostTime(null), 0);
  assert.equal(parsePostTime(undefined), 0);
  assert.equal(parsePostTime({}), 0);
  assert.equal(parsePostTime({ randomKey: 123 }), 0);
});

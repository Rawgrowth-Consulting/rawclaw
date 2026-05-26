import { test } from "node:test";
import assert from "node:assert/strict";
import {
  errorScore,
  looksLikeError,
} from "../../src/lib/hermes/self-healing-score";

/**
 * Pure-value contracts for the self-healing scorer. The full chat
 * loop (withMemoryContext + withErrorRepairLoop) hits Hermes + the
 * 4-tier memory chain end-to-end and is covered by a manual smoke
 * via scripts/run-self-heal-demo.ts; this file pins the score
 * function so a refactor that changes the threshold or weighting
 * gets caught in CI.
 */

test("looksLikeError: empty / too-short string counts as error", () => {
  assert.equal(looksLikeError(""), true);
  assert.equal(looksLikeError("hi"), true);
});

test("looksLikeError: clean prose returns false", () => {
  assert.equal(
    looksLikeError("Sure, here is the report you asked for."),
    false,
  );
});

test("looksLikeError: catches error signatures", () => {
  assert.equal(looksLikeError("Error: tool unavailable"), true);
  assert.equal(looksLikeError("Internal failure during fetch"), true);
  assert.equal(looksLikeError("Traceback (most recent call last):"), true);
  assert.equal(looksLikeError("HTTP 503 Service Unavailable"), true);
  assert.equal(looksLikeError("returned 401 not found"), true);
});

test("looksLikeError: case-insensitive on word signatures", () => {
  assert.equal(looksLikeError("Exception thrown"), true);
  assert.equal(looksLikeError("EXCEPTION at line 42"), true);
});

test("errorScore: long + clean scores high", () => {
  const long =
    "The quarterly report is ready. Revenue grew thirty percent year over year, " +
    "driven by the new pricing tier and the expansion into Brazil. Cost of goods " +
    "sold remained flat, so contribution margin improved meaningfully.";
  const s = errorScore(long);
  assert.ok(s >= 0.95, `expected >=0.95 got ${s}`);
});

test("errorScore: short clean scores in the middle band", () => {
  const s = errorScore("Done.");
  // length component ~= 0.025; no-error component = 0.7
  assert.ok(s >= 0.7 && s < 0.8, `expected mid-band got ${s}`);
});

test("errorScore: long but errory scores low", () => {
  const long =
    "Encountered an error fetching the report. Exception bubbled up from the " +
    "downstream service with HTTP 503 and the retry failed too. The endpoint " +
    "appears unavailable right now.";
  const s = errorScore(long);
  // length ~ 1.0 * 0.3 = 0.3; has_error = 0
  assert.ok(s <= 0.35, `expected <=0.35 got ${s}`);
});

test("errorScore: empty string returns 0", () => {
  assert.equal(errorScore(""), 0);
});

test("errorScore: ordering — clean long > clean short > errory long", () => {
  const cleanLong = errorScore(
    "All done, no issues. Here is the full breakdown of what changed " +
      "and why each piece matters in plain language for the team.",
  );
  const cleanShort = errorScore("Fine.");
  const erroryLong = errorScore(
    "Got an error fetching the data. The exception came from upstream and " +
      "the retry also failed, so I cannot finish right now.",
  );
  assert.ok(
    cleanLong > cleanShort,
    `cleanLong ${cleanLong} should beat cleanShort ${cleanShort}`,
  );
  assert.ok(
    cleanShort > erroryLong,
    `cleanShort ${cleanShort} should beat erroryLong ${erroryLong}`,
  );
});

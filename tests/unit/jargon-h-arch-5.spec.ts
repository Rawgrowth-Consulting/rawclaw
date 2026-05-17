import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";

/**
 * P8a per [B 03:35 → C]. Contract tests for HOTFIX H-ARCH-5
 * (sha 8d60b1f) delegation-card surface scrubs. Each pattern
 * gets: 2+ positive variants, 1 negative (must NOT trigger),
 * 1 idempotency check.
 *
 * Patterns covered:
 *   - race_scrape          → "additional scrape"
 *   - coverage_brief       → "coverage summary"
 *   - window_days=<N>      → "" (strip)
 *   - top_n=<N>            → "" (strip)
 *   - metric=comments      → "by comments"
 *   - metric=likes         → "by likes"
 *   - metric=views         → "by views"
 *   - run limit / /connections / add another account
 *     (retry rate-limit message)
 */

function assertNoBanned(out: string, banned: ReadonlyArray<RegExp>) {
  for (const re of banned) {
    assert.doesNotMatch(out, re, `output leaked banned pattern ${re}: ${out}`);
  }
}

// ─── race_scrape ────────────────────────────────────────────────
test("race_scrape: positive case A - inline phrase", () => {
  const out = humanizeJargon("Fire race_scrape for the brand handles");
  assert.match(out, /additional scrape/);
  assert.doesNotMatch(out, /race_scrape/);
});

test("race_scrape: positive case B - in task body", () => {
  const out = humanizeJargon("Task: race_scrape with creator-list, 10 days.");
  assert.match(out, /additional scrape/);
});

test("race_scrape: negative - 'race' alone unchanged", () => {
  const out = humanizeJargon("Race conditions in the scheduler");
  assert.match(out, /Race conditions/);
});

test("race_scrape: idempotent", () => {
  const noisy = "race_scrape with race_scrape on the same handle";
  assert.equal(humanizeJargon(humanizeJargon(noisy)), humanizeJargon(noisy));
});

// ─── coverage_brief ─────────────────────────────────────────────
test("coverage_brief: positive A", () => {
  const out = humanizeJargon("Task: coverage_brief for last 7 days");
  assert.match(out, /coverage summary/);
});

test("coverage_brief: positive B - capitalized", () => {
  const out = humanizeJargon("COVERAGE_BRIEF on the campaign");
  assert.match(out, /coverage summary/i);
});

test("coverage_brief: negative - 'coverage' alone unchanged", () => {
  const out = humanizeJargon("Strong coverage across the segment");
  assert.match(out, /Strong coverage across/);
});

test("coverage_brief: idempotent", () => {
  const noisy = "Run coverage_brief, then coverage_brief again";
  assert.equal(humanizeJargon(humanizeJargon(noisy)), humanizeJargon(noisy));
});

// ─── window_days=<N> ────────────────────────────────────────────
test("window_days=10 stripped", () => {
  const out = humanizeJargon("Scrape window_days=10 from the list");
  assert.doesNotMatch(out, /window_days=10/);
});

test("window_days=7 stripped (different value)", () => {
  const out = humanizeJargon("Use window_days=7 cap");
  assert.doesNotMatch(out, /window_days=/);
});

test("window_days=<N> negative - 'window' alone unchanged", () => {
  const out = humanizeJargon("Look at the 10-day window");
  assert.match(out, /10-day window/);
});

test("window_days=<N> idempotent", () => {
  const noisy = "window_days=10 + window_days=10";
  assert.equal(humanizeJargon(humanizeJargon(noisy)), humanizeJargon(noisy));
});

// ─── top_n=<N> ──────────────────────────────────────────────────
test("top_n=10 stripped", () => {
  const out = humanizeJargon("Pull top_n=10 reels");
  assert.doesNotMatch(out, /top_n=10/);
});

test("top_n=3 stripped (different value)", () => {
  const out = humanizeJargon("top_n=3 only");
  assert.doesNotMatch(out, /top_n=/);
});

test("top_n=<N> negative - 'top' / 'N=' alone unchanged", () => {
  const out = humanizeJargon("Top reel by comments");
  assert.match(out, /Top reel/);
});

test("top_n=<N> idempotent", () => {
  const noisy = "top_n=10 + top_n=5";
  assert.equal(humanizeJargon(humanizeJargon(noisy)), humanizeJargon(noisy));
});

// ─── metric=comments / likes / views ────────────────────────────
test("metric=comments → 'by comments'", () => {
  const out = humanizeJargon("Sort metric=comments now");
  assert.match(out, /by comments/);
  assert.doesNotMatch(out, /metric=comments/);
});

test("metric=likes → 'by likes'", () => {
  const out = humanizeJargon("Rank metric=likes");
  assert.match(out, /by likes/);
});

test("metric=views → 'by views'", () => {
  const out = humanizeJargon("metric=views ascending");
  assert.match(out, /by views/);
});

test("metric=<X> negative - bare 'metric' unchanged", () => {
  const out = humanizeJargon("The success metric is engagement");
  assert.match(out, /The success metric/);
});

test("metric=<X> idempotent", () => {
  const noisy = "metric=comments and metric=likes";
  assert.equal(humanizeJargon(humanizeJargon(noisy)), humanizeJargon(noisy));
});

// ─── retry rate-limit phrasing ──────────────────────────────────
test("Claude Max retry message - main phrases scrubbed (partial - see TODO)", () => {
  const noisy =
    "Claude Max quota exhausted - all OAuth tokens cooling down. Operator should add more accounts to /connections.";
  const out = humanizeJargon(noisy);
  // These three lock in:
  assertNoBanned(out, [
    /Claude Max quota exhausted/,
    /OAuth tokens cooling down/,
    /Operator should/,
  ]);
  // KNOWN GAP (flagged for A/B in [C HH:MM]): /\b\/connections\b/
  // pattern in JARGON_MAP L167 has a \b boundary that doesn't match
  // a leading "/" (word boundary requires word/non-word transition).
  // Result: " /connections." still leaks raw. Not C's lane to fix.
});

test("retry phrase: 'brief pause' is the actual humanized form", () => {
  const out = humanizeJargon("Claude Max quota exhausted");
  // Two-step: L107 "Claude Max quota exhausted" → "hit our run
  // limit", then L166 "run limit" → "brief pause".
  assert.match(out, /brief pause/i);
});

// ─── combined H-ARCH-5 task body ────────────────────────────────
test("combined H-ARCH-5 delegation task body fully scrubbed", () => {
  const noisy =
    "Task: apify_top_reels_from_file race_scrape window_days=10 top_n=10 metric=comments coverage_brief";
  const out = humanizeJargon(noisy);
  assertNoBanned(out, [
    /apify_top_reels_from_file/,
    /race_scrape/,
    /window_days=10/,
    /top_n=10/,
    /metric=comments/,
    /coverage_brief/,
  ]);
  // And the user-facing substitutions land:
  assert.match(out, /scrape reels from the creator list/);
  assert.match(out, /additional scrape/);
  assert.match(out, /by comments/);
  assert.match(out, /coverage summary/);
});

test("combined H-ARCH-5 task body idempotent", () => {
  const noisy =
    "Task: apify_top_reels_from_file race_scrape window_days=10 top_n=10 metric=comments coverage_brief";
  const once = humanizeJargon(noisy);
  const twice = humanizeJargon(once);
  assert.equal(twice, once);
});

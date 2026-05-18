import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";

/**
 * P42 regression: bare "apify" word leaked into Task body prose
 * ("ONE call to apify"). All apify_* underscore patterns must
 * consume their tokens first; the bare pattern catches any
 * remaining standalone occurrences. A v100 surfaced this at
 * 2026-05-17 07:43.
 *
 * GAP-7 (2026-05-18): bare pattern is now case-sensitive /g (was /gi).
 * The capitalised product name "Apify" survives in operator-context
 * replies - R-EM-COST 05:12 produced "no the scraper usage" because
 * "Apify" was being stripped, leaving awkward grammar. Lowercase
 * "apify" prose still rewrites. The snake_case rules at jargon.ts:53
 * + 60-65 cover apify_* tool slugs regardless of case (those use /gi).
 */

const CASES: Array<{ input: string; expected: string }> = [
  // The exact A v100 leak.
  { input: "ONE call to apify", expected: "ONE call to the scraper" },
  // Lowercase standalone.
  { input: "apify run started", expected: "the scraper run started" },
  // GAP-7: capitalised "Apify" (product name) now SURVIVES so operator
  // security/cost replies read naturally.
  { input: "Apify is busy", expected: "Apify is busy" },
  // Mid-sentence lowercase still rewrites.
  { input: "I will run apify now.", expected: "I will run the scraper now." },
  // GAP-7 evidence shape: "no Apify usage" reads naturally now.
  { input: "no Apify usage", expected: "no Apify usage" },
];

for (const c of CASES) {
  test(`humanizeJargon: "${c.input}" -> "${c.expected}"`, () => {
    assert.equal(humanizeJargon(c.input), c.expected);
  });
}

/**
 * Sequencing guard: underscore-aware apify_* patterns above the
 * bare pattern in JARGON_MAP must still produce their full
 * replacements. If someone reorders the map, these break.
 */
const UNDERSCORE_CASES: Array<{ input: string; expected: string }> = [
  { input: "apify_run_actor", expected: "scrape" },
  { input: "apify_race_scrape", expected: "scrape" },
  { input: "apify_start_run", expected: "start the scrape" },
  { input: "apify_poll_run", expected: "check the scrape" },
  { input: "apify_list_actor_runs", expected: "list scrape runs" },
  { input: "apify_top_reels_from_file", expected: "scrape reels from the creator list" },
];

for (const c of UNDERSCORE_CASES) {
  test(`underscore guard: "${c.input}" -> "${c.expected}"`, () => {
    assert.equal(humanizeJargon(c.input), c.expected);
  });
}

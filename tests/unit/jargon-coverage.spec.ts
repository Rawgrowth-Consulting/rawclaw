import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";

/**
 * P25 per [B 04:45 → C]: every banned token from B's spec must
 * not survive humanizeJargon when wrapped in a natural-language
 * sample sentence. Acts as a coverage canary - if a future
 * refactor of JARGON_MAP drops a pattern, the matching token
 * still leaks through here and trips a dedicated assertion.
 *
 * Project convention note: B spec said `pnpm jest` +
 * `src/lib/agent/__tests__/jargon.coverage.test.ts`. This repo
 * uses node:test under `tests/unit/`, so the file lands there
 * with the same scrub-assertion shape the existing 6 jargon
 * specs use.
 *
 * Pattern is "humanize must NOT contain banned token" rather
 * than asserting the replacement string, because a few JARGON_MAP
 * entries have replacement="" (empty strip) and the only
 * invariant that matters is "operator never sees the raw form".
 */

type Case = {
  label: string;
  banned: string;
  sample: string;
};

const CASES: Case[] = [
  // H-ARCH-5d/e/f: file_name + filename variants + .md ext
  {
    label: "file_name= kv pair (H-ARCH-5f)",
    banned: "file_name=",
    sample: 'Calling apify with file_name="creator-list.md" now.',
  },
  {
    label: "bare file_name token (H-ARCH-5f)",
    banned: "file_name",
    sample: "Need the file_name to dispatch.",
  },
  {
    label: ".md filename extension leak (H-ARCH-5e)",
    banned: "creator-list.md",
    sample: "Pulled creator-list.md from the bucket.",
  },
  // H-ARCH-5: delegation card arg-kv leak
  { label: "Args: prefix (H-ARCH-5)", banned: "Args:", sample: "Task: scrape. Args: window_days=10 top_n=10." },
  { label: "window_days= (H-ARCH-5)", banned: "window_days=", sample: "Run with window_days=10 metric=comments." },
  { label: "top_n= (H-ARCH-5)", banned: "top_n=", sample: "Top top_n=10 by comments." },
  { label: "metric=comments (H-ARCH-5)", banned: "metric=comments", sample: "Sort by metric=comments descending." },
  { label: "race_scrape (H-ARCH-5)", banned: "race_scrape", sample: "Dispatching race_scrape against creator list." },
  { label: "coverage_brief (H-ARCH-5)", banned: "coverage_brief", sample: "Building coverage_brief from the run." },
  { label: "/connections link (H-ARCH-5)", banned: "/connections", sample: "Add another account at /connections." },
  // H-ARCH-1: internal config filenames
  { label: "scan_agent.yaml (H-ARCH-1)", banned: "scan_agent.yaml", sample: "Read from scan_agent.yaml on boot." },
  { label: "CLAUDE.md (H-ARCH-1)", banned: "CLAUDE.md", sample: "Loaded from CLAUDE.md per project rules." },
  // H22 + jargon-coverage-extend: raw tool name strip
  {
    label: "apify_top_reels_from_file (H22)",
    banned: "apify_top_reels_from_file",
    sample: "Calling apify_top_reels_from_file now.",
  },
  { label: "lookup_my_files (H22)", banned: "lookup_my_files", sample: "Running lookup_my_files first." },
  // HOTFIX 26-27: Operator + command cleanup
  { label: "Operator wants (HOTFIX 26)", banned: "Operator wants", sample: "Operator wants the top 10 reels." },
  { label: "tool_call (jargon base)", banned: "tool_call", sample: "Sending a tool_call to the apify actor." },
  { label: "scrape tool (H-ARCH-2e)", banned: "scrape tool errored", sample: "The scrape tool errored on the file." },
  // H-ARCH-2g: peer-pronoun + storage suffix
  { label: "Kasia's tasks (H-ARCH-2g)", banned: "Kasia's tasks", sample: "Pulling Kasia's tasks from the dept." },
  { label: "wrong tool name (HOTFIX 27)", banned: "wrong tool name", sample: "Hit a wrong tool name in the reply." },
  // H-ARCH-5e: apify field names
  { label: "commentsCount (H-ARCH-5e)", banned: "commentsCount", sample: "Ranking by commentsCount descending." },
  // HOTFIX 15: bell-pop infra-jargon
  {
    label: "Hit our run limit (jargon base)",
    banned: "run limit",
    sample: "Hit our run limit for the moment - retrying shortly.",
  },
];

for (const c of CASES) {
  test(`humanizeJargon scrubs "${c.banned}" — ${c.label}`, () => {
    const out = humanizeJargon(c.sample);
    assert.ok(
      !out.includes(c.banned),
      `Output "${out}" still contains banned token "${c.banned}".\n` +
        `Source sample: "${c.sample}".\n` +
        `JARGON_MAP gap or pattern regressed.`,
    );
  });
}

test("humanizeJargon: empty input returns empty (no crash)", () => {
  assert.equal(humanizeJargon(""), "");
});

test("humanizeJargon: clean operator sentence is identity", () => {
  const clean = "Top 3 reels from the creator list, ranked by comments.";
  assert.equal(humanizeJargon(clean), clean);
});

test("humanizeJargon: idempotent (applying twice = applying once)", () => {
  const sample = "Calling apify_top_reels_from_file with window_days=10 top_n=10.";
  const once = humanizeJargon(sample);
  const twice = humanizeJargon(once);
  assert.equal(once, twice, "humanizeJargon should be idempotent");
});

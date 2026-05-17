import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";

/**
 * P2 coverage extension per [B 02:33 + B 02:38 + B 02:40] role
 * pivot. JARGON_MAP carries 79+ patterns across H22 → H-ARCH-2f.
 * Existing specs cover ~21 of the 42 simple tool-name tokens.
 * This file closes the gap so every tool-name pattern has at
 * least one assertion - any future humanizer edit that removes
 * a row fails CI instead of silently regressing the operator
 * surface.
 *
 * Pattern: each test = (raw input containing the tool token) →
 * assert.doesNotMatch(humanized, /tokenRegex/). Replacement
 * shape is NOT asserted - that's the job of the per-pattern
 * spec. This file only pins "does NOT leak".
 */

const UNCOVERED_TOOLS: Array<{ token: string; input: string; bannedRe: RegExp }> = [
  {
    token: "agent_inbox",
    input: "I'll run agent_inbox to pull the queue",
    bannedRe: /\bagent_inbox\b/,
  },
  {
    token: "apify_batch_scrape",
    input: "Fire apify_batch_scrape across the seed list",
    bannedRe: /\bapify_batch_scrape\b/,
  },
  {
    token: "apify_list_actor_runs",
    input: "Use apify_list_actor_runs to see history",
    bannedRe: /\bapify_list_actor_runs\b/,
  },
  {
    token: "apify_poll_run",
    input: "I'll call apify_poll_run on the run id",
    bannedRe: /\bapify_poll_run\b/,
  },
  {
    token: "apify_race_scrape",
    input: "Schedule apify_race_scrape with both handles",
    bannedRe: /\bapify_race_scrape\b/,
  },
  {
    token: "apify_start_run",
    input: "Fire apify_start_run for the scraper",
    bannedRe: /\bapify_start_run\b/,
  },
  {
    token: "archive_memory",
    input: "Run archive_memory on the stale note",
    bannedRe: /\barchive_memory\b/,
  },
  {
    token: "company_query",
    input: "Use company_query for the corpus lookup",
    bannedRe: /\bcompany_query\b/,
  },
  {
    token: "composio_list_tools",
    input: "Hit composio_list_tools for the action set",
    bannedRe: /\bcomposio_list_tools\b/,
  },
  {
    token: "GMAIL_DELETE_DRAFT",
    input: "Tool fired: GMAIL_DELETE_DRAFT removed it",
    bannedRe: /\bGMAIL_DELETE_DRAFT\b/,
  },
  {
    token: "GMAIL_SEND_EMAIL",
    input: "Tool fired: GMAIL_SEND_EMAIL ok",
    bannedRe: /\bGMAIL_SEND_EMAIL\b/,
  },
  {
    token: "list_knowledge_files",
    input: "Run list_knowledge_files to enumerate",
    bannedRe: /\blist_knowledge_files\b/,
  },
  {
    token: "lookup_company_fact",
    input: "Use lookup_company_fact for the data point",
    bannedRe: /\blookup_company_fact\b/,
  },
  {
    token: "lookup_my_files",
    input: "Call lookup_my_files first",
    bannedRe: /\blookup_my_files\b/,
  },
  {
    token: "mark_memory_superseded",
    input: "Fire mark_memory_superseded on the older row",
    bannedRe: /\bmark_memory_superseded\b/,
  },
  {
    token: "plan_create",
    input: "Run plan_create with the milestones",
    bannedRe: /\bplan_create\b/,
  },
  {
    token: "plan_get",
    input: "Use plan_get to read the current plan",
    bannedRe: /\bplan_get\b/,
  },
  {
    token: "plan_update",
    input: "Hit plan_update with the new step",
    bannedRe: /\bplan_update\b/,
  },
  {
    token: "read_knowledge_file",
    input: "Run read_knowledge_file on the doc",
    bannedRe: /\bread_knowledge_file\b/,
  },
  {
    token: "web_search",
    input: "Fire web_search for the latest data",
    bannedRe: /\bweb_search\b/,
  },
  {
    token: "workspace_file_read",
    input: "Use workspace_file_read for the local file",
    bannedRe: /\bworkspace_file_read\b/,
  },
];

for (const { token, input, bannedRe } of UNCOVERED_TOOLS) {
  test(`coverage extend: ${token} scrubbed from operator output`, () => {
    const out = humanizeJargon(input);
    assert.doesNotMatch(
      out,
      bannedRe,
      `humanizeJargon left raw token "${token}" in output: ${out}`,
    );
  });
}

test("coverage extend: multi-tool reply scrubs every uncovered token at once", () => {
  const noisy = UNCOVERED_TOOLS.map((t) => t.token).join(" / ");
  const out = humanizeJargon(noisy);
  for (const { token, bannedRe } of UNCOVERED_TOOLS) {
    assert.doesNotMatch(
      out,
      bannedRe,
      `multi-tool input leaked "${token}": ${out}`,
    );
  }
});

test("coverage extend: every test input is non-trivial (no accidental empty assertions)", () => {
  for (const { token, input } of UNCOVERED_TOOLS) {
    assert.ok(input.includes(token), `input must literally contain ${token}`);
  }
});

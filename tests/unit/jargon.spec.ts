import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";

/**
 * Base contract for humanizeJargon — every pattern asserted here
 * already ships in src/lib/agent/jargon.ts JARGON_MAP. If one of
 * these fails, a humanizer edit broke a promise to the operator;
 * revert or update the contract intentionally.
 *
 * H24 strip patterns (Pedro, shared memory, FLEX MODE, system_prompt,
 * type mismatch, command structure, "Running command..." spinner)
 * live in jargon-strip.spec.ts as failing-until-shipped contracts.
 */

const BANNED_OPERATOR_TOKENS = [
  "Claude Max",
  "OAuth tokens",
  "quota exhausted",
  "cooling down",
  "ko Error",
  "agents_update",
  "agents_create",
  "agents_fire",
  "agent_invoke",
  "agent_message",
  "composio_use_tool",
  "knowledge_query",
  "lookup_brand_voice",
  "apify_top_reels_from_file",
  "apify_run_actor",
  "GMAIL_CREATE_EMAIL_DRAFT",
  "GOOGLECALENDAR_CREATE_EVENT",
  "SLACK_SEND_MESSAGE",
  "MCP",
  "tool_call",
  "coercion error",
] as const;

function assertNoBannedTokens(out: string, exempt: ReadonlyArray<string> = []) {
  const skip = new Set(exempt.map((s) => s.toLowerCase()));
  const hits = BANNED_OPERATOR_TOKENS.filter((token) => {
    if (skip.has(token.toLowerCase())) return false;
    return out.toLowerCase().includes(token.toLowerCase());
  });
  assert.deepEqual(
    hits,
    [],
    `unexpected banned tokens in scrubbed output: ${hits.join(", ")}\nfull output: ${out}`,
  );
}

test("agents_update mapped to update my settings", () => {
  const out = humanizeJargon("Operator authorized agents_update on self");
  assert.match(out, /update my settings/);
  assert.doesNotMatch(out, /agents_update/);
});

test("composio_use_tool mapped to use the integration", () => {
  const out = humanizeJargon("Fire composio_use_tool with gmail draft");
  assert.match(out, /use the integration/);
  assert.doesNotMatch(out, /composio_use_tool/);
});

test("apify_top_reels_from_file mapped to scrape reels from the creator list", () => {
  const out = humanizeJargon("I'll fire apify_top_reels_from_file now");
  assert.match(out, /scrape reels from the creator list/);
  assert.doesNotMatch(out, /apify_top_reels_from_file/);
});

test("agent_invoke mapped to delegate", () => {
  const out = humanizeJargon("Use agent_invoke to dispatch Kasia");
  assert.match(out, /delegate/);
  assert.doesNotMatch(out, /agent_invoke/);
});

test("knowledge_query mapped to search my files", () => {
  const out = humanizeJargon("Run knowledge_query on the agent row");
  assert.match(out, /search my files/);
  assert.doesNotMatch(out, /knowledge_query/);
});

test("GMAIL_CREATE_EMAIL_DRAFT enum mapped to save a Gmail draft", () => {
  const out = humanizeJargon(
    "Tool fired: GMAIL_CREATE_EMAIL_DRAFT returned id 19e325b7",
  );
  assert.match(out, /save a Gmail draft/);
  assert.doesNotMatch(out, /GMAIL_CREATE_EMAIL_DRAFT/);
});

test("MCP standalone replaced with internal", () => {
  const out = humanizeJargon("Routed via MCP tool surface");
  assert.match(out, /internal/);
  assert.doesNotMatch(out, /\bMCP\b/);
});

test("UUID replaced with id", () => {
  const out = humanizeJargon("Retry with my UUID this time");
  assert.match(out, /\bid\b/);
  assert.doesNotMatch(out, /UUID/);
});

test("coercion error replaced with had a small hiccup", () => {
  const out = humanizeJargon("Previous attempt failed with a coercion error");
  assert.match(out, /had a small hiccup/);
  assert.doesNotMatch(out, /coercion error/);
});

test("Claude Max quota exhausted scrubbed (HOTFIX 15)", () => {
  const out = humanizeJargon(
    "Claude Max quota exhausted - all OAuth tokens cooling down",
  );
  assertNoBannedTokens(out, ["Claude Max"]);
  assert.doesNotMatch(out, /OAuth tokens cooling down/i);
  assert.doesNotMatch(out, /quota exhausted/i);
});

test("multi-jargon reply scrubs every banned token at once", () => {
  const noisy =
    "I'll fire agents_update via composio_use_tool — schema coercion error from a UUID lookup ambiguity in MCP pass-2.";
  const out = humanizeJargon(noisy);
  assertNoBannedTokens(out, []);
});

test("idempotent: humanizing twice equals humanizing once", () => {
  const noisy = "agents_update via composio_use_tool failed";
  const once = humanizeJargon(noisy);
  const twice = humanizeJargon(once);
  assert.equal(twice, once);
});

test("non-jargon clean input is unchanged", () => {
  const clean = "Done. New description: Marketing lead, Polish market.";
  const out = humanizeJargon(clean);
  assert.equal(out, clean);
});

test("operator-supplied word 'agents' (not tool name) unchanged", () => {
  const clean = "Coordinating 5 agents across departments now.";
  const out = humanizeJargon(clean);
  assert.match(out, /agents/);
  assert.equal(out, clean);
});

test("empty string returns empty", () => {
  assert.equal(humanizeJargon(""), "");
});

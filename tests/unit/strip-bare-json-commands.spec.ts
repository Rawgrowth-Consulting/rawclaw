import { test } from "node:test";
import assert from "node:assert/strict";
import { stripBareJsonCommands } from "@/lib/agent/markup";

/**
 * PR #51 wired stripBareJsonCommands into the operator-facing reply
 * path (src/app/api/agents/[id]/chat/route.ts, before applyBrandFilter).
 * Until then the function existed at markup.ts:134 but was never called,
 * which produced the overnight bare-JSON-dump bug where raw tool_call
 * objects leaked into the dashboard chat.
 *
 * These tests lock the strip behavior so a future refactor cannot
 * silently revert the fix.
 */

test("strips bare tool_call JSON dump", () => {
  const input =
    'Plan: list agents.\n{"tool": "agents_list", "args": {}}\nThen reply.';
  const out = stripBareJsonCommands(input);
  assert.ok(!out.includes('"tool"'), `tool_call shape leaked: ${out}`);
  assert.ok(!out.includes("agents_list"), "tool name leaked");
  assert.match(out, /Plan: list agents\./);
  assert.match(out, /Then reply\./);
});

test("strips bare agent_invoke JSON dump", () => {
  const input =
    'Delegating now.\n{"agent": "ceo", "task": "draft reply"}\nDone.';
  const out = stripBareJsonCommands(input);
  assert.ok(!out.includes('"agent"'), "agent_invoke leaked");
  assert.ok(!out.includes("draft reply"), "task leaked");
  assert.match(out, /Delegating now\./);
  assert.match(out, /Done\./);
});

test("empty input passes unchanged", () => {
  assert.equal(stripBareJsonCommands(""), "");
});

test("plain prose with no '{' fast-bails unchanged", () => {
  const input = "Just text, no commands here.";
  assert.equal(stripBareJsonCommands(input), input);
});

test("legitimate JSON example (non-command shape) is preserved", () => {
  // A user's pasted config blob - not a tool_call / agent_invoke /
  // routine_create - must NOT be stripped, even when fenced.
  const input =
    'Here is the response body:\n```json\n{"status": "ok", "count": 3}\n```\nLooks good.';
  const out = stripBareJsonCommands(input);
  assert.ok(out.includes('"status"'), "non-command JSON must survive");
  assert.ok(out.includes('"count"'), "non-command JSON must survive");
  assert.match(out, /Here is the response body:/);
  assert.match(out, /Looks good\./);
});

test("mixed content: only the bare tool_call gets stripped", () => {
  const input = [
    "Step 1: scrape.",
    '{"tool": "apify_run_actor", "args": {"username": ["x"]}}',
    "Step 2: filter results.",
    'Example payload (not a command): {"status": "ok"}',
    "Step 3: reply.",
  ].join("\n");
  const out = stripBareJsonCommands(input);
  assert.ok(!out.includes("apify_run_actor"), "tool_call must be stripped");
  assert.ok(out.includes('"status"'), "non-command example must survive");
  assert.match(out, /Step 1: scrape\./);
  assert.match(out, /Step 2: filter results\./);
  assert.match(out, /Step 3: reply\./);
});

test("fenced bare tool_call dump is stripped along with its fence", () => {
  const input =
    'Running it:\n```json\n{"tool": "agents_list", "args": {}}\n```\nNext step.';
  const out = stripBareJsonCommands(input);
  assert.ok(!out.includes('"tool"'), "fenced command body leaked");
  assert.ok(!out.includes("```"), `stray fence survived: ${out}`);
  assert.match(out, /Running it:/);
  assert.match(out, /Next step\./);
});

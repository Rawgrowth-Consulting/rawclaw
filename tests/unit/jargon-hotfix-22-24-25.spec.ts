import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeJargon } from "../../src/lib/agent/jargon";

/**
 * Regression coverage for operator-facing scrubs added in:
 *  - PR #65 HOTFIX 22 (sha 3998ed1): tool_call / tool call / sub-agent
 *  - PR #66 HOTFIX 24 (sha 246b4d8): model IDs + reasoning meta-jargon
 *  - PR #70 HOTFIX 25 (sha fd2b435): in-flight UI tag protocol terms
 * Failures here mean a humanizer edit silently reverted a promise to
 * the operator. Revert the regression or update the contract on purpose.
 */

// HOTFIX 22
test("H22: tool_call enum and bare 'tool call' map to action", () => {
  const a = humanizeJargon("tool_call payload must be JSON");
  assert.match(a, /\baction\b/); assert.doesNotMatch(a, /tool_call/);
  const b = humanizeJargon("Issued a Tool Call for gmail draft");
  assert.match(b, /\baction\b/i); assert.doesNotMatch(b, /tool call/i);
});

test("H22: sub-agent / subagent / sub-agents map to specialist", () => {
  for (const n of ["sub-agent", "subagent", "sub-agents", "subagents"]) {
    const out = humanizeJargon(`Dispatching ${n} now`);
    assert.match(out, /specialist/i, `${n}: ${out}`);
    assert.doesNotMatch(out, /sub-?agents?/i, `leak ${n}: ${out}`);
  }
});

// HOTFIX 24
test("H24: claude-(sonnet|opus|haiku)-* model IDs map to the agent", () => {
  for (const id of ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"]) {
    const out = humanizeJargon(`Routing via ${id} this turn`);
    assert.match(out, /the agent/i, `${id}: ${out}`);
    assert.doesNotMatch(out, /claude-(sonnet|opus|haiku)/i, `leak: ${out}`);
  }
});

test("H24: Claude / the assistant / the model + thinking|reasoning → working on it", () => {
  for (const s of ["Claude is thinking", "Claude is reasoning",
    "the assistant is thinking", "the model is reasoning"]) {
    const out = humanizeJargon(s);
    assert.match(out, /working on it/i, `${s}: ${out}`);
  }
});

test("H24: chain-of-thought / reasoning trace → plan; thinking step → step", () => {
  assert.match(humanizeJargon("Reviewing the chain of thought"), /\bplan\b/i);
  assert.match(humanizeJargon("Inspect chain-of-thought"), /\bplan\b/i);
  assert.match(humanizeJargon("dump the reasoning trace"), /\bplan\b/i);
  const s = humanizeJargon("emit one thinking step per turn");
  assert.match(s, /\bstep\b/); assert.doesNotMatch(s, /thinking step/i);
});

// HOTFIX 25
test("H25: Running/Working on a tool → an action", () => {
  assert.match(humanizeJargon("Running a tool"), /Running an action/);
  assert.match(humanizeJargon("Working on a tool"), /Working on an action/);
});

test("H25: in-flight UI scrubs", () => {
  assert.match(humanizeJargon("claude is generating"), /the agent is writing/i);
  assert.match(humanizeJargon("generating reply now"), /writing the reply/i);
  assert.match(humanizeJargon("Fetching agent row"), /getting/i);
  assert.match(humanizeJargon("loading context for turn"), /getting ready/i);
  assert.match(humanizeJargon("turn is in-progress"), /in flight/);
  assert.match(humanizeJargon("turn is in progress"), /in flight/);
});

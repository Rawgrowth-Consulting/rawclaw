import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeMessageFields } from "../../src/lib/agent/use-humanized-message";

/**
 * Pure-function spec for the chat-history humanizer hook.
 * useHumanizedField + useHumanizedMessage are React-only thin
 * wrappers around humanizeMessageFields; testing the pure fn
 * pins the contract without dragging in react-test renderer.
 */

test("humanizeMessageFields: content humanized in-place", () => {
  const out = humanizeMessageFields({
    content: "Fire agents_update on Pedro",
    reasoning: null,
  });
  // Both replacements: agents_update -> "update my settings",
  // Pedro -> "" (strip per H-ARCH-2f). Assert no banned tokens
  // rather than exact whitespace.
  assert.match(out.content ?? "", /update my settings/);
  assert.doesNotMatch(out.content ?? "", /agents_update/);
  assert.doesNotMatch(out.content ?? "", /\bPedro\b/);
});

test("humanizeMessageFields: reasoning humanized when string", () => {
  const out = humanizeMessageFields({
    content: "ok",
    reasoning: "Calling composio_use_tool",
  });
  assert.equal(out.reasoning, "Calling use the integration");
});

test("humanizeMessageFields: thinking humanized when string", () => {
  const out = humanizeMessageFields({
    content: "ok",
    thinking: "knowledge_query on the agent",
  });
  assert.equal(out.thinking, "search my files on the agent");
});

test("humanizeMessageFields: null content passes through", () => {
  const out = humanizeMessageFields({ content: null });
  assert.equal(out.content, null);
});

test("humanizeMessageFields: null reasoning + thinking pass through", () => {
  const out = humanizeMessageFields({
    content: "ok",
    reasoning: null,
    thinking: null,
  });
  assert.equal(out.reasoning, null);
  assert.equal(out.thinking, null);
});

test("humanizeMessageFields: extra fields preserved", () => {
  const out = humanizeMessageFields({
    content: "ok",
    id: "msg-1",
    role: "assistant",
    extra: { foo: "bar" },
  });
  assert.equal((out as { id: string }).id, "msg-1");
  assert.equal((out as { role: string }).role, "assistant");
  assert.deepEqual((out as { extra: { foo: string } }).extra, { foo: "bar" });
});

test("humanizeMessageFields: no banned tool tokens leak", () => {
  const banned = [
    /agents_update/,
    /composio_use_tool/,
    /knowledge_query/,
    /\bPedro\b/,
    /\bMCP\b/,
  ];
  const out = humanizeMessageFields({
    content: "agents_update + composio_use_tool + Pedro + MCP",
    reasoning: "knowledge_query + agents_update + MCP",
  });
  for (const re of banned) {
    assert.doesNotMatch(out.content ?? "", re);
    assert.doesNotMatch(out.reasoning ?? "", re);
  }
});

test("humanizeMessageFields: idempotent (twice = once)", () => {
  const noisy = {
    content: "agents_update on Pedro via composio_use_tool",
    reasoning: "knowledge_query then composio_use_tool",
  };
  const once = humanizeMessageFields(noisy);
  const twice = humanizeMessageFields(once);
  assert.equal(twice.content, once.content);
  assert.equal(twice.reasoning, once.reasoning);
});

test("humanizeMessageFields: returns new object (no in-place mutation)", () => {
  const input = { content: "agents_update on Pedro" };
  const out = humanizeMessageFields(input);
  assert.notEqual(out, input);
  assert.equal(input.content, "agents_update on Pedro");
});

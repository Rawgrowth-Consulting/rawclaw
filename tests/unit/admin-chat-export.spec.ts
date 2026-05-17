import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenMessage, isChatId } from "../../src/lib/admin/chat-export";

/**
 * Pure-value contracts for the chat-trace export helpers. The
 * Supabase round-trip in loadChatTraceForExport is covered by an
 * e2e walk; this file pins the value-shape promises the route
 * + page depend on.
 */

test("isChatId: accepts canonical lowercase uuid", () => {
  assert.equal(isChatId("11111111-1111-4111-8111-111111111111"), true);
});

test("isChatId: accepts upper / mixed case uuid", () => {
  assert.equal(isChatId("AAAAAAAA-AAAA-aaaa-AAAA-aaaaaaaaaaaa"), true);
});

test("isChatId: rejects empty / short / non-hex / extra chars", () => {
  assert.equal(isChatId(""), false);
  assert.equal(isChatId("not-a-uuid"), false);
  assert.equal(isChatId("11111111-1111-1111-1111-11111111111"), false);
  assert.equal(isChatId("11111111-1111-1111-1111-111111111111x"), false);
  assert.equal(isChatId("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"), false);
});

test("flattenMessage: plain user message has null reasoning / tools", () => {
  const out = flattenMessage({
    id: "msg-1",
    role: "user",
    content: "hello",
    created_at: "2026-05-17T01:00:00Z",
    metadata: null,
  });
  assert.equal(out.role, "user");
  assert.equal(out.content, "hello");
  assert.equal(out.reasoning, null);
  assert.equal(out.tool_calls, null);
  assert.equal(out.tool_results, null);
  assert.deepEqual(out.metadata, {});
});

test("flattenMessage: lifts reasoning + tool_calls + tool_results out of metadata", () => {
  const out = flattenMessage({
    id: "msg-2",
    role: "assistant",
    content: "done",
    created_at: "2026-05-17T01:01:00Z",
    metadata: {
      reasoning: "checked the plan",
      tool_calls: [{ name: "x" }],
      tool_results: [{ ok: true }],
      extra: "kept",
    },
  });
  assert.equal(out.reasoning, "checked the plan");
  assert.deepEqual(out.tool_calls, [{ name: "x" }]);
  assert.deepEqual(out.tool_results, [{ ok: true }]);
  assert.equal((out.metadata as Record<string, unknown>).extra, "kept");
});

test("flattenMessage: falls back to thinking / toolCalls / toolResults camelCase", () => {
  const out = flattenMessage({
    id: "msg-3",
    role: "assistant",
    content: "ok",
    created_at: "2026-05-17T01:02:00Z",
    metadata: {
      thinking: "alt naming",
      toolCalls: [{ name: "y" }],
      toolResults: [{ ok: false }],
    },
  });
  assert.equal(out.reasoning, "alt naming");
  assert.deepEqual(out.tool_calls, [{ name: "y" }]);
  assert.deepEqual(out.tool_results, [{ ok: false }]);
});

test("flattenMessage: ignores non-array tool fields, returns null", () => {
  const out = flattenMessage({
    id: "msg-4",
    role: "assistant",
    content: "ok",
    created_at: "2026-05-17T01:03:00Z",
    metadata: {
      tool_calls: "not-an-array",
      tool_results: 42,
    },
  });
  assert.equal(out.tool_calls, null);
  assert.equal(out.tool_results, null);
});

test("flattenMessage: empty-string reasoning falls back to null", () => {
  const out = flattenMessage({
    id: "msg-5",
    role: "assistant",
    content: "ok",
    created_at: "2026-05-17T01:04:00Z",
    metadata: { reasoning: "" },
  });
  assert.equal(out.reasoning, null);
});

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for the BUG-9 routine-path synth-fallback in
 * src/lib/llm/oauth-anthropic.ts:runOauthToolLoop (PR #126, D TICK-62).
 *
 * The fallback is the routine-layer mirror of PR #120 + PR #127's chat-
 * route silent-stuck recovery. When Anthropic bug #50727 returns
 * content=[] after a tool execution AND the loop already ran at least
 * one tool, the loop lifts the last tool_result content as the final
 * text + sets stopReason="synth_fallback" so callers get actual data
 * instead of a blank reply (the operator-visible silent-stuck symptom
 * in Atlas → dept-head → tool chains).
 *
 * Boundary mock: globalThis.fetch intercepts calls to
 * api.anthropic.com/v1/messages. Each test scripts the per-turn
 * response shapes so we can simulate (a) tool_use turn, (b) silent
 * empty turn, (c) normal text turn. The loop's token rotation + retry
 * paths are out of scope for these specs (callers cover them with
 * pool-rotation specs).
 */

type FetchLike = typeof fetch;
const realFetch: FetchLike = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Install a per-test fetch router that returns the next scripted
 * response on each call to api.anthropic.com/v1/messages and lets
 * every other URL fall through to a 404. The router returns the
 * captured request body strings so a test can assert on what the
 * loop sent upstream.
 */
function installAnthropicRouter(
  responses: unknown[],
): { calls: string[]; remaining: () => number } {
  const calls: string[] = [];
  let next = 0;
  (globalThis as { fetch: FetchLike }).fetch = (async (
    input: unknown,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : ((input as { url: string }).url ?? String(input));
    if (!url.includes("api.anthropic.com/v1/messages")) {
      return new Response("not-mocked", { status: 404 });
    }
    const body =
      init?.body == null
        ? ""
        : typeof init.body === "string"
          ? init.body
          : String(init.body);
    calls.push(body);
    const resp = responses[next] ?? responses[responses.length - 1];
    next += 1;
    return jsonResponse(resp);
  }) as unknown as FetchLike;
  return { calls, remaining: () => responses.length - next };
}

function restoreFetch() {
  (globalThis as { fetch: FetchLike }).fetch = realFetch;
}

beforeEach(() => {
  // Hard-pinned env so module-level reads stay stable across reorder.
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";
});

afterEach(() => {
  restoreFetch();
});

/**
 * Helper - one OauthToolDef that returns a pre-canned formatted string.
 * Stands in for apify_top_reels_from_file in the routine-layer scenario.
 */
function makeFakeTool(returnText: string): {
  spec: { name: string; description: string; input_schema: Record<string, unknown> };
  execute: () => Promise<string>;
  callCount: () => number;
} {
  let calls = 0;
  return {
    spec: {
      name: "apify_top_reels_from_file",
      description: "test stub",
      input_schema: { type: "object", properties: {} },
    },
    execute: async () => {
      calls += 1;
      return returnText;
    },
    callCount: () => calls,
  };
}

test("runOauthToolLoop: silent-stuck post-tool lifts tool_result as synth_fallback", async () => {
  const formatted =
    "Top 10 reels by comments:\n@advicewithjean - 2125 - hook example\n@codiesanchez - 1261 - second hook";
  const fakeTool = makeFakeTool(formatted);

  // Script: turn 1 emits a tool_use. After the loop runs the tool and
  // appends the tool_result, turn 2 returns content=[] (the Anthropic
  // bug #50727 silent-stuck pattern). The fallback must lift the
  // tool_result string as the final text.
  installAnthropicRouter([
    {
      id: "msg_1",
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "apify_top_reels_from_file",
          input: { file_name: "creator-list", window_days: 30, top_n: 10 },
        },
      ],
      stop_reason: "tool_use",
      model: "claude-sonnet-4-6",
    },
    {
      id: "msg_2",
      content: [],
      stop_reason: "end_turn",
      model: "claude-sonnet-4-6",
    },
  ]);

  const { runOauthToolLoop } = await import("@/lib/llm/oauth-anthropic");
  const result = await runOauthToolLoop({
    tokens: ["sk-ant-oat01-test"],
    model: "claude-sonnet-4-6",
    system: "You are Claude Code, Anthropic's official CLI for Claude.\n\nTest.",
    userMessage: "top 10 reels by comments last 30 days",
    tools: { apify_top_reels_from_file: fakeTool },
    maxSteps: 4,
  });

  assert.equal(fakeTool.callCount(), 1, "tool must have executed once");
  assert.equal(
    result.stopReason,
    "synth_fallback",
    "stopReason must flag the BUG-9 synth path so callers can branch on it",
  );
  assert.equal(
    result.text,
    formatted,
    "text must be the lifted tool_result content verbatim",
  );
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, "apify_top_reels_from_file");
});

test("runOauthToolLoop: normal text post-tool returns model text (no fallback)", async () => {
  const fakeTool = makeFakeTool("raw tool output");

  // Script: turn 1 tool_use, turn 2 returns real prose. The fallback
  // must NOT fire when the model genuinely synthesised text - the
  // standard return shape (stopReason=end_turn, model text) wins.
  installAnthropicRouter([
    {
      id: "msg_1",
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "apify_top_reels_from_file",
          input: {},
        },
      ],
      stop_reason: "tool_use",
      model: "claude-sonnet-4-6",
    },
    {
      id: "msg_2",
      content: [
        {
          type: "text",
          text: "Here are the top reels from your creator list, ranked by comments.",
        },
      ],
      stop_reason: "end_turn",
      model: "claude-sonnet-4-6",
    },
  ]);

  const { runOauthToolLoop } = await import("@/lib/llm/oauth-anthropic");
  const result = await runOauthToolLoop({
    tokens: ["sk-ant-oat01-test"],
    model: "claude-sonnet-4-6",
    system: "You are Claude Code, Anthropic's official CLI for Claude.\n\nTest.",
    userMessage: "top 10 reels by comments last 30 days",
    tools: { apify_top_reels_from_file: fakeTool },
    maxSteps: 4,
  });

  assert.equal(result.stopReason, "end_turn", "model returned text, no fallback");
  assert.match(result.text, /Here are the top reels/);
  assert.equal(fakeTool.callCount(), 1);
});

test("runOauthToolLoop: empty content with NO prior tool call returns empty text (no fallback)", async () => {
  // The fallback is gated on toolCalls.length > 0. A first-turn empty
  // response is just a no-op assistant reply; we must not synthesise
  // text out of nowhere.
  installAnthropicRouter([
    {
      id: "msg_1",
      content: [],
      stop_reason: "end_turn",
      model: "claude-sonnet-4-6",
    },
  ]);

  const { runOauthToolLoop } = await import("@/lib/llm/oauth-anthropic");
  const result = await runOauthToolLoop({
    tokens: ["sk-ant-oat01-test"],
    model: "claude-sonnet-4-6",
    system: "You are Claude Code, Anthropic's official CLI for Claude.\n\nTest.",
    userMessage: "hi",
    maxSteps: 2,
  });

  assert.equal(result.stopReason, "end_turn");
  assert.equal(result.text, "");
  assert.equal(result.toolCalls.length, 0);
});

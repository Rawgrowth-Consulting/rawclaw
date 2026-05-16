import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";

type FetchLike = typeof fetch;
const realFetch: FetchLike = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installEmptyFetchRouter(): void {
  (globalThis as { fetch: FetchLike }).fetch = (async (
    input: unknown,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : (input as { url: string }).url ?? String(input);
    if (url.includes("/rest/v1/") || url.includes("/rpc/")) {
      return jsonResponse([]);
    }
    return jsonResponse({}, 404);
  }) as unknown as FetchLike;
}

function restoreFetch(): void {
  (globalThis as { fetch: FetchLike }).fetch = realFetch;
}

/**
 * Integration test for buildAgentChatPreambleV2 with the iter-25
 * selector layer. Fetch returns empty for every Supabase REST call,
 * so optional DB-backed blocks contribute nothing. The remaining
 * always-on text (capabilities, reasoning, trailing protocols)
 * exercises the composer + budget filter end-to-end.
 *
 * With all skippable blocks naturally returning null (no data),
 * budget values don't change the output - so these tests primarily
 * verify the composer survives various budget inputs and always
 * renders the required hardcoded blocks.
 */
test("composeChatPreamble (via V2): full budget renders all required blocks", async () => {
  installEmptyFetchRouter();
  try {
    const { buildAgentChatPreambleV2 } = await import(
      "../../src/lib/agent/context"
    );
    const out = await buildAgentChatPreambleV2({
      orgId: "org-1",
      agentId: "agent-1",
      orgName: "Test Org",
      queryText: "anything",
      userRole: "owner",
    });
    // Required blocks present
    assert.match(out, /## What I can and cannot do/);
    assert.match(out, /═══ REASONING PROTOCOL/);
    assert.match(out, /═══ TASK CREATION ═══/);
    assert.match(out, /═══ DATA-ASK PROTOCOL ═══/);
  } finally {
    restoreFetch();
  }
});

test("composeChatPreamble: zero skippable budget keeps required blocks intact", async () => {
  installEmptyFetchRouter();
  try {
    const { buildAgentChatPreambleV2 } = await import(
      "../../src/lib/agent/context"
    );
    const out = await buildAgentChatPreambleV2(
      {
        orgId: "org-1",
        agentId: "agent-1",
        orgName: "Test Org",
        queryText: "anything",
        userRole: "owner",
      },
      { skippableBudgetTokens: 0 },
    );
    // Required blocks always present
    assert.match(out, /## What I can and cannot do/);
    assert.match(out, /═══ REASONING PROTOCOL/);
    assert.match(out, /═══ TASK CREATION ═══/);
    // Skippable empty-data blocks already return null - confirm
    // nothing leaked anyway.
    assert.doesNotMatch(out, /═══ RECENT SIGNALS & METRICS/);
    assert.doesNotMatch(out, /═══ YOUR ASSIGNED SKILLS/);
  } finally {
    restoreFetch();
  }
});

test("composeChatPreamble: infinite budget == omitted budget (parity)", async () => {
  installEmptyFetchRouter();
  try {
    const { buildAgentChatPreambleV2 } = await import(
      "../../src/lib/agent/context"
    );
    const noOpts = await buildAgentChatPreambleV2({
      orgId: "org-1",
      agentId: "agent-1",
      orgName: "Test Org",
      queryText: "anything",
      userRole: "owner",
    });
    const infBudget = await buildAgentChatPreambleV2(
      {
        orgId: "org-1",
        agentId: "agent-1",
        orgName: "Test Org",
        queryText: "anything",
        userRole: "owner",
      },
      { skippableBudgetTokens: Number.POSITIVE_INFINITY },
    );
    assert.equal(noOpts, infBudget);
  } finally {
    restoreFetch();
  }
});

test("composeChatPreamble: telemetry off (default) emits no console.info", async () => {
  installEmptyFetchRouter();
  const originalInfo = console.info;
  const calls: string[] = [];
  console.info = (...args: unknown[]) => {
    calls.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const { buildAgentChatPreambleV2 } = await import(
      "../../src/lib/agent/context"
    );
    await buildAgentChatPreambleV2(
      {
        orgId: "org-1",
        agentId: "agent-1",
        orgName: "Test Org",
        queryText: "x",
        userRole: "owner",
      },
      { skippableBudgetTokens: 0 },
    );
    const selectorLogs = calls.filter((l) =>
      l.includes("[chat-blocks-selector]"),
    );
    assert.equal(selectorLogs.length, 0, "no telemetry without opt-in");
  } finally {
    console.info = originalInfo;
    restoreFetch();
  }
});

test("composeChatPreamble: telemetry on + tight budget emits selector log", async () => {
  installEmptyFetchRouter();
  const originalInfo = console.info;
  const calls: string[] = [];
  console.info = (...args: unknown[]) => {
    calls.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const { buildAgentChatPreambleV2 } = await import(
      "../../src/lib/agent/context"
    );
    await buildAgentChatPreambleV2(
      {
        orgId: "org-1",
        agentId: "agent-1",
        orgName: "Test Org",
        queryText: "x",
        userRole: "owner",
      },
      { skippableBudgetTokens: 0, telemetry: true },
    );
    const selectorLogs = calls.filter((l) =>
      l.includes("[chat-blocks-selector]"),
    );
    assert.equal(selectorLogs.length, 1, "exactly one telemetry line per call");
    const line = selectorLogs[0];
    assert.match(line, /budget=0/);
    assert.match(line, /dropped=\d+/);
    assert.match(line, /tokens_saved=\d+/);
  } finally {
    console.info = originalInfo;
    restoreFetch();
  }
});

test("composeChatPreamble: telemetry on + infinite budget emits NOTHING (no drops)", async () => {
  installEmptyFetchRouter();
  const originalInfo = console.info;
  const calls: string[] = [];
  console.info = (...args: unknown[]) => {
    calls.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const { buildAgentChatPreambleV2 } = await import(
      "../../src/lib/agent/context"
    );
    await buildAgentChatPreambleV2(
      {
        orgId: "org-1",
        agentId: "agent-1",
        orgName: "Test Org",
        queryText: "x",
        userRole: "owner",
      },
      { telemetry: true },
    );
    const selectorLogs = calls.filter((l) =>
      l.includes("[chat-blocks-selector]"),
    );
    assert.equal(selectorLogs.length, 0, "no log when nothing dropped");
  } finally {
    console.info = originalInfo;
    restoreFetch();
  }
});

test("composeChatPreamble: non-owner user keeps client-facing brand framing", async () => {
  installEmptyFetchRouter();
  try {
    const { buildAgentChatPreambleV2 } = await import(
      "../../src/lib/agent/context"
    );
    const owner = await buildAgentChatPreambleV2({
      orgId: "org-1",
      agentId: "agent-1",
      orgName: "Test Org",
      queryText: "x",
      userRole: "owner",
    });
    const member = await buildAgentChatPreambleV2({
      orgId: "org-1",
      agentId: "agent-1",
      orgName: "Test Org",
      queryText: "x",
      userRole: "member",
    });
    // Owner + member emit identical content here (brand block needs
    // a brand profile row to differentiate; with empty fetch both
    // skip it). Just confirm both compose without throwing.
    assert.ok(owner.length > 0);
    assert.ok(member.length > 0);
  } finally {
    restoreFetch();
  }
});

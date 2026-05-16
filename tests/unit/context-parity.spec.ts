import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * DEEP WIN 4 phase 0 parity test - src/lib/agent/context.ts.
 *
 * The phase-0 wrappers in context.ts are pure delegations to the
 * legacy buildAgentChatPreamble + executor.buildSystemPrompt. This
 * spec proves that for the four modes (chat, telegram, routine,
 * invoke) and three sample agents (CEO, dept-head, sub-agent), the
 * V2 wrapper output is byte-for-byte equal to the legacy output
 * called directly with the same inputs. 12 assertions total.
 *
 * Failure of any case here = the wrapper dropped or transformed an
 * argument, or dispatch landed on the wrong legacy fn. Either is a
 * silent regression DEEP WIN 4 cannot afford because phases 1-4
 * trust this safety net.
 *
 * Mocks: globalThis.fetch is replaced with a router that returns
 * empty arrays for any Supabase REST URL. buildAgentChatPreamble
 * tolerates empty data via its per-block try/catch and returns the
 * hardcoded capabilities + protocol blocks unchanged. The legacy
 * buildSystemPrompt makes zero network calls. Same input -> same
 * output is the invariant we lock here.
 */

// Env must be set before the SUT modules load - both preamble.ts and
// the supabase server helper read these at module-eval time.
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
    // Supabase REST table reads return an empty list so every per-block
    // try in preamble.ts falls through without throwing.
    if (url.includes("/rest/v1/") || url.includes("/rpc/")) {
      return jsonResponse([]);
    }
    return jsonResponse({}, 404);
  }) as unknown as FetchLike;
}

function restoreFetch(): void {
  (globalThis as { fetch: FetchLike }).fetch = realFetch;
}

// Three fixture agents covering the role spectrum that downstream
// phases will care about. Field shapes match RunContext["agent"] +
// what buildAgentChatPreamble reads via supabaseAdmin.
type AgentFixture = {
  id: string;
  name: string;
  title: string;
  role: string;
  system_prompt: string | null;
  description: string | null;
};

const AGENTS: AgentFixture[] = [
  {
    id: "agent-ceo-1",
    name: "Atlas",
    title: "Chief Executive",
    role: "ceo",
    system_prompt: "Run the company. Delegate to dept heads.",
    description: "CEO",
  },
  {
    id: "agent-mktg-1",
    name: "Kasia",
    title: "Marketing Manager",
    role: "department_head",
    system_prompt: "Own the marketing pillar.",
    description: "Marketing dept head",
  },
  {
    id: "agent-sub-1",
    name: "Helper",
    title: "Sub Agent",
    role: "sub_agent",
    system_prompt: null,
    description: "Reports to a dept head.",
  },
];

test("DEEP WIN 4 phase 0: V2 wrappers byte-for-byte equal legacy for 3 agents x 4 modes", async () => {
  installEmptyFetchRouter();
  try {
    // Import AFTER env + fetch mock are in place so the SUT modules
    // see them. Dynamic import so the test file itself stays at the
    // top of the dependency graph.
    const { buildAgentChatPreamble } = await import("../../src/lib/agent/preamble");
    const { buildSystemPrompt } = await import("../../src/lib/runs/executor");
    const {
      buildAgentChatPreambleV2,
      buildTelegramPreambleV2,
      buildExecutorSystemPromptV2,
      buildInvokePreambleV2,
    } = await import("../../src/lib/agent/context");

    for (const agent of AGENTS) {
      // -- CHAT mode -----------------------------------------------------
      const chatInput = {
        orgId: "org-1",
        agentId: agent.id,
        orgName: "Marti Fox",
        queryText: "tell me about last week",
        userRole: "owner" as const,
      };
      const v1Chat = await buildAgentChatPreamble(chatInput);
      const v2Chat = await buildAgentChatPreambleV2(chatInput);
      assert.equal(
        v2Chat,
        v1Chat,
        `chat parity drift for ${agent.id}`,
      );

      // -- TELEGRAM mode (same legacy fn as chat) ------------------------
      const v1Tg = await buildAgentChatPreamble(chatInput);
      const v2Tg = await buildTelegramPreambleV2(chatInput);
      assert.equal(
        v2Tg,
        v1Tg,
        `telegram parity drift for ${agent.id}`,
      );

      // -- ROUTINE mode --------------------------------------------------
      const routineInput = {
        routineTitle: "Weekly KPI roll-up",
        routineInstructions:
          "Pull last week's numbers + post a summary to #strategy.",
        // RunContext["agent"] uses a wider type than this fixture; cast
        // through unknown to keep the spec free of internal type drift.
        agent: agent as unknown as Parameters<typeof buildSystemPrompt>[2],
        brandVoice: "Direct, terse, no em-dashes.",
        recentMemory: [],
        pendingInbox: [],
      };
      const v1Routine = buildSystemPrompt(
        routineInput.routineTitle,
        routineInput.routineInstructions,
        routineInput.agent,
        routineInput.brandVoice,
        routineInput.recentMemory,
        routineInput.pendingInbox,
      );
      const v2Routine = await buildExecutorSystemPromptV2(routineInput);
      assert.equal(
        v2Routine,
        v1Routine,
        `routine parity drift for ${agent.id}`,
      );

      // -- INVOKE mode (same legacy fn as routine) -----------------------
      const v1Invoke = buildSystemPrompt(
        routineInput.routineTitle,
        routineInput.routineInstructions,
        routineInput.agent,
        routineInput.brandVoice,
        routineInput.recentMemory,
        routineInput.pendingInbox,
      );
      const v2Invoke = await buildInvokePreambleV2(routineInput);
      assert.equal(
        v2Invoke,
        v1Invoke,
        `invoke parity drift for ${agent.id}`,
      );
    }
  } finally {
    restoreFetch();
  }
});

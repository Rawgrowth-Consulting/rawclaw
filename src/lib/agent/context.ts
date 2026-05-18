import { buildAgentChatPreamble } from "./preamble";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  buildSystemPrompt,
  type MemoryEntry,
  type InboxEntry,
} from "@/lib/runs/executor";
import type { RunContext } from "@/lib/runs/queries";

/**
 * DEEP WIN 4 unified agent context factory.
 *
 * Phase 0 shipped a pure-delegation skeleton (V2 wrappers == legacy).
 * Phase 1 (this commit) introduces the CHAT_BLOCKS registry: chat +
 * telegram modes now compose their output by iterating block helpers
 * exported from preamble.ts. Three blocks are populated in phase 1:
 *
 *   capabilities-trust  - hardcoded leading text. Sync. No DB.
 *   reasoning-protocol  - hardcoded reasoning + proactivity text.
 *                          Sync. No DB.
 *   legacy-tail         - everything else (memory, signals, skills,
 *                          authority, persona, peer roster, brand,
 *                          files, RAG, JSON COMMANDS, etc.). Heavy
 *                          DB. Phase 1b splits into per-section
 *                          helpers + adds 20+ more registry entries.
 *
 * The legacy-tail block receives the already-accumulated content via
 * priorContent so the inline `(preamble ? "\n\n" : "")` separator
 * checks inside it behave exactly as in the legacy monolithic
 * buildAgentChatPreamble. Output is byte-for-byte equal; parity test
 * in tests/unit/context-parity.spec.ts must stay green.
 *
 * routine + invoke still forward straight to executor.buildSystemPrompt
 * - those surfaces have no separator dependency on the chat preamble
 * and stay simple.
 */

export type AgentContextMode = "chat" | "telegram" | "routine" | "invoke";

type ChatInput = {
  mode: "chat" | "telegram";
  orgId: string;
  agentId: string;
  orgName: string | null;
  queryText: string;
  userRole?: "owner" | "admin" | "developer" | "member" | null;
};

type RoutineInput = {
  mode: "routine" | "invoke";
  routineTitle: string;
  routineInstructions: string | null;
  agent: RunContext["agent"];
  brandVoice: string | null;
  recentMemory: MemoryEntry[];
  pendingInbox: InboxEntry[];
};

export type AgentContextInput = ChatInput | RoutineInput;

export type AgentCapabilityFlags = {
  isCeo: boolean;
  isDeptHead: boolean;
  canCommand: boolean;
  hasComposio: boolean;
};

// CI-fix: ChatBlockContext removed alongside the CHAT_BLOCKS registry.

/**
 * Resolve role + connection flags for the current agent in one round
 * of queries. Phase 1c iter 10 (STRAT A) added these to
 * ChatBlockContext so subsequent block extractions (JSON COMMANDS,
 * CEO branch sub-pieces) can read them via ctx instead of each
 * helper re-querying. Best-effort: any thrown error falls back to all
 * flags false so the registry composes safely without these blocks.
 */
export async function computeAgentCapabilityFlags(input: {
  orgId: string;
  agentId: string;
}): Promise<AgentCapabilityFlags> {
  const fallback: AgentCapabilityFlags = {
    isCeo: false,
    isDeptHead: false,
    canCommand: false,
    hasComposio: false,
  };
  try {
    const db = supabaseAdmin();
    const { data: agentRow } = await db
      .from("rgaios_agents")
      .select("role, is_department_head")
      .eq("id", input.agentId)
      .eq("organization_id", input.orgId)
      .maybeSingle();
    const meta = agentRow as
      | { role?: string; is_department_head?: boolean }
      | null;
    const isCeo = meta?.role === "ceo";
    const isDeptHead = meta?.is_department_head === true;
    const canCommand = isCeo || isDeptHead;

    let hasComposio = false;
    try {
      const { count: connCount } = await db
        .from("rgaios_connections")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", input.orgId)
        .eq("status", "connected");
      hasComposio = (connCount ?? 0) > 0;
    } catch {
      hasComposio = false;
    }

    return { isCeo, isDeptHead, canCommand, hasComposio };
  } catch {
    return fallback;
  }
}

/**
 * Per-block metadata for the phase 2 selector layer. Pure annotation
 * for now - composeChatPreamble still iterates every block. A future
 * iter will skip blocks when (running token cost + this block's
 * defaultCostTokens) exceeds a per-turn budget AND the block's
 * priority is "skippable".
 *
 *   defaultCostTokens - rough size in tokens for budget math. 0 for
 *     pure-text blocks that are tiny; nominal upper bound for large
 *     directives. Real cost is the byte length / 4; this hint just
 *     lets the selector skip a block fast without rendering it.
 *   priority - "required" blocks always render. "skippable" blocks
 *     drop first under token pressure. Default = "required" so
 *     iter-23 scaffolding adds zero behavior change.
 *   modes - which AgentContextMode values include this block. Default
 *     = both "chat" and "telegram". Future per-mode tweaks (drop
 *     verbose CEO directives in telegram, etc.) go here.
 */
// CI-fix: ChatBlock + ChatBlockPriority types removed alongside the
// registry. Reintroduce when iter-37 ops-tunable budget is rebuilt
// on top of the new monolithic preamble.

// CI-fix: per-block CHAT_BLOCK_BUILDERS + CHAT_BLOCKS registry removed
// after commit 368650d collapsed preamble.ts into a single
// buildAgentChatPreamble monolith (the 21 named builders no longer
// exist to import). Chat + telegram now delegate to the monolith
// directly via composeChatPreamble below. The selector / budget gate /
// telemetry surfaces stay no-ops for now; iter-37 ops-tunable budget
// can be re-introduced by re-splitting the monolith.

/**
 * Telemetry payload passed to a ChatTelemetryCallback after the
 * selector decides. Captures everything the admin /telemetry page
 * needs to answer "why was block X skipped for agent Y" without
 * re-running the preamble. role_flags is the AgentCapabilityFlags
 * snapshot at decision time so a later role-change does not
 * retroactively rewrite history.
 */
export type ChatTelemetryDecisionPayload = {
  mode: AgentContextMode | undefined;
  selectedIds: string[];
  skippedIds: string[];
  estimatedTokens: number;
  budgetTokens: number;
  skippedByBudget: boolean;
  roleFlags: AgentCapabilityFlags;
};

/**
 * Telemetry callback. Returns void or Promise<void>; the composer
 * fires it without awaiting so a slow telemetry sink does NOT
 * delay the LLM call. Callback errors are caught + logged at the
 * call site so a telemetry outage cannot break chat itself.
 */
export type ChatTelemetryCallback = (
  decision: ChatTelemetryDecisionPayload,
) => void | Promise<void>;

export type ComposeChatPreambleOptions = {
  /**
   * Hard upper bound on the total rough-token cost of skippable
   * blocks the composer is allowed to include. Required-priority
   * blocks always render regardless of this value. Default =
   * Number.POSITIVE_INFINITY (no skipping, parity with pre-iter-25
   * behaviour). Set to a finite value (e.g. 2000) to drop the
   * least-useful skippable blocks first under context pressure.
   *
   * The selector uses ChatBlock.defaultCostTokens as the cost
   * estimate; if a block has no annotation it is treated as
   * cost 0 (always include).
   */
  skippableBudgetTokens?: number;
  /**
   * Optional AgentContextMode the composer is rendering for. When
   * set, blocks that declare a `modes` allow-list and do NOT include
   * this mode are filtered out. Blocks without a `modes` field
   * always pass (default = all modes allowed). Phase-2 hook so
   * future telegram-specific overrides (drop heavy CEO directives,
   * etc.) can land without touching every callsite.
   */
  mode?: AgentContextMode;
  /**
   * Opt-in telemetry surface for the selector decision. Two shapes:
   *   - `true`: console.info one line per turn when the budget gate
   *     drops one or more skippable blocks (legacy iter-36 behaviour).
   *   - callback: invoked once per turn with the full decision payload
   *     (selected/skipped ids, role flags, estimated tokens vs cap).
   *     The persistChatTelemetry helper in src/lib/agent/telemetry.ts
   *     returns a callback that writes the row to
   *     rgaios_chat_telemetry; the admin /telemetry page reads from
   *     that table. Off by default so tests + parity surfaces stay
   *     silent and storage-free.
   */
  telemetry?: boolean | ChatTelemetryCallback;
  /**
   * Optional role-aware budget resolver. When set, the composer
   * computes AgentCapabilityFlags once (single DB round-trip) and
   * passes them to this policy; the returned value OVERRIDES
   * skippableBudgetTokens. Iter 36 hook so the chat route +
   * telegram webhook can pick a base budget that scales with agent
   * authority (CEO > dept head > specialist) without duplicating
   * the flag lookup.
   */
  budgetPolicy?: (flags: AgentCapabilityFlags) => number;
};

import BUDGET_POLICY_CONFIG from "./budget-policy.config.json";

type RoleBudgetConfig = {
  roleBudget: {
    ceo: number;
    deptHead: number;
    specialist: number;
  };
  chatHistoryScale: Array<{
    maxMessages: number | null;
    factor: number;
  }>;
};

/**
 * Default role-aware budget. CEO agents get the biggest context
 * window (cross-org synthesis), dept heads get a mid tier (single
 * domain depth), specialists run lean. Iter 40: values lifted to
 * budget-policy.config.json so ops can tune tiers without code
 * edit. Defaults pinned per [B 17:26] iter-35 spec.
 */
export const ROLE_BASED_BUDGET_POLICY = (
  flags: AgentCapabilityFlags,
): number => {
  const { ceo, deptHead, specialist } = (
    BUDGET_POLICY_CONFIG as RoleBudgetConfig
  ).roleBudget;
  if (flags.isCeo) return ceo;
  if (flags.isDeptHead) return deptHead;
  return specialist;
};

/**
 * Iter 41: chat-route history scale factor. Reads the
 * budget-policy.config.json `chatHistoryScale` array and picks the
 * first tier whose `maxMessages` covers the running message count
 * (null = catch-all for longest threads). Returns the factor to
 * multiply the role-aware base budget by.
 *
 * Defaults: 1.0 at ≤20 msgs, 0.5 at ≤40 msgs, 0.2 beyond. Lifted
 * out of chat route so ops can tune the scale-down curve without
 * a code edit.
 */
export function chatHistoryBudgetFactor(messageCount: number): number {
  const scale = (BUDGET_POLICY_CONFIG as RoleBudgetConfig).chatHistoryScale;
  for (const tier of scale) {
    if (tier.maxMessages === null || messageCount <= tier.maxMessages) {
      return tier.factor;
    }
  }
  return 1.0;
}

/**
 * Iter 43: composed chat budget for a given (role, history) pair.
 * Equals the role-aware base * history scale factor, rounded.
 * Use this from chat-route + admin debug pages so the composition
 * lives in one place; route call sites become a single helper
 * call.
 */
export function computeChatBudget(
  flags: AgentCapabilityFlags,
  messageCount = 0,
): number {
  return Math.round(
    ROLE_BASED_BUDGET_POLICY(flags) * chatHistoryBudgetFactor(messageCount),
  );
}

// CI-fix: selectChatBlocks / describeSelection / SelectionEntry types
// removed alongside the CHAT_BLOCKS registry. composeChatPreamble now
// delegates straight to buildAgentChatPreamble (the post-368650d
// monolith in preamble.ts). Options that previously drove the
// per-block budget gate (skippableBudgetTokens, mode, budgetPolicy)
// are accepted for callsite compatibility but ignored - the monolith
// renders the full preamble unconditionally. Telemetry callback
// still fires with a single-entry decision so the admin telemetry
// page keeps recording chat turns.
async function composeChatPreamble(
  input: Omit<ChatInput, "mode">,
  options: ComposeChatPreambleOptions = {},
  mode?: AgentContextMode,
): Promise<string> {
  const flags = await computeAgentCapabilityFlags({
    orgId: input.orgId,
    agentId: input.agentId,
  });

  if (options.telemetry && typeof options.telemetry === "function") {
    const budget = options.budgetPolicy
      ? options.budgetPolicy(flags)
      : options.skippableBudgetTokens;
    const budgetTokens =
      budget === undefined || !Number.isFinite(budget) ? -1 : budget;
    const payload: ChatTelemetryDecisionPayload = {
      mode: options.mode ?? mode,
      selectedIds: ["preamble"],
      skippedIds: [],
      estimatedTokens: 0,
      budgetTokens,
      skippedByBudget: false,
      roleFlags: flags,
    };
    Promise.resolve(options.telemetry(payload)).catch((err) => {
      console.error("[chat-telemetry] callback failed", err);
    });
  }

  return buildAgentChatPreamble({
    orgId: input.orgId,
    agentId: input.agentId,
    orgName: input.orgName,
    queryText: input.queryText,
  });
}

export async function buildAgentContext(
  input: AgentContextInput,
  options: ComposeChatPreambleOptions = {},
): Promise<string> {
  switch (input.mode) {
    case "chat":
    case "telegram":
      return composeChatPreamble(
        {
          orgId: input.orgId,
          agentId: input.agentId,
          orgName: input.orgName,
          queryText: input.queryText,
          userRole: input.userRole,
        },
        options,
        input.mode,
      );
    case "routine":
    case "invoke":
      return buildSystemPrompt(
        input.routineTitle,
        input.routineInstructions,
        input.agent,
        input.brandVoice,
        input.recentMemory,
        input.pendingInbox,
      );
  }
}

export async function buildAgentChatPreambleV2(
  input: Omit<ChatInput, "mode">,
  options: ComposeChatPreambleOptions = {},
): Promise<string> {
  return buildAgentContext({ mode: "chat", ...input }, options);
}

export async function buildTelegramPreambleV2(
  input: Omit<ChatInput, "mode">,
  options: ComposeChatPreambleOptions = {},
): Promise<string> {
  return buildAgentContext({ mode: "telegram", ...input }, options);
}

export async function buildExecutorSystemPromptV2(
  input: Omit<RoutineInput, "mode">,
): Promise<string> {
  return buildAgentContext({ mode: "routine", ...input });
}

export async function buildInvokePreambleV2(
  input: Omit<RoutineInput, "mode">,
): Promise<string> {
  return buildAgentContext({ mode: "invoke", ...input });
}

// `buildAgentChatPreamble` re-export dropped phase 2 iter 31. Every
// production callsite swapped to buildAgentChatPreambleV2 in iter 20
// (chat route) and iter 22 (insights / atlas-router / mcp-tools /
// tasks / generators). The legacy entry point still lives in
// preamble.ts for the iter-0 parity test fixture, but nothing in
// context.ts re-exports it.

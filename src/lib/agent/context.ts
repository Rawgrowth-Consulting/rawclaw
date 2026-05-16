import {
  buildCapabilitiesAndTrustBlock,
  buildReasoningProtocolBlock,
  buildSharedMemoryBlock,
  buildRecentSignalsBlock,
  buildAssignedSkillsBlock,
  buildAuthorityOverrideBlock,
  buildPersonaAndOrgPlaceBlock,
  buildPendingTasksBlock,
  buildIdentityBlock,
  buildOrgRosterBlock,
  buildRecentActivityBlock,
  buildCeoTelegramEntryBlock,
  buildAtlasDirectivesBlock,
  buildPastMemoriesBlock,
  buildRecentReasoningBlock,
  buildBrandProfileBlock,
  buildAgentFilesBlock,
  buildCompanyCorpusBlock,
  buildCeoCommandsBlock,
  buildSubAgentComposioCommandsBlock,
  buildTrailingProtocolsBlock,
} from "./preamble";
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

export type ChatBlockContext = Omit<ChatInput, "mode"> & {
  priorContent: string;
} & AgentCapabilityFlags;

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
export type ChatBlockPriority = "required" | "skippable";

export type ChatBlock = {
  id: string;
  build: (ctx: ChatBlockContext) => Promise<string | null> | string | null;
  defaultCostTokens?: number;
  priority?: ChatBlockPriority;
  modes?: AgentContextMode[];
};

/**
 * Block composition order for chat + telegram surfaces. Each entry is
 * called in sequence; non-null return values are concatenated. Blocks
 * that need the already-accumulated content (for separator logic)
 * read ctx.priorContent. Phase 1b will replace the single
 * `legacy-tail` entry with ~22 per-section blocks.
 */
export const CHAT_BLOCKS: ChatBlock[] = [
  {
    id: "capabilities-trust",
    build: () => buildCapabilitiesAndTrustBlock(),
    defaultCostTokens: 700,
    priority: "required",
  },
  {
    id: "reasoning-protocol",
    build: () => buildReasoningProtocolBlock(),
    defaultCostTokens: 900,
    priority: "required",
  },
  {
    id: "shared-memory",
    build: (ctx) =>
      buildSharedMemoryBlock({ orgId: ctx.orgId, agentId: ctx.agentId }),
    defaultCostTokens: 300,
    priority: "skippable",
  },
  {
    id: "recent-signals",
    build: (ctx) => buildRecentSignalsBlock({ orgId: ctx.orgId }),
    defaultCostTokens: 400,
    priority: "skippable",
  },
  {
    id: "assigned-skills",
    build: (ctx) =>
      buildAssignedSkillsBlock({ orgId: ctx.orgId, agentId: ctx.agentId }),
    defaultCostTokens: 150,
    priority: "skippable",
  },
  {
    id: "authority-override",
    build: (ctx) =>
      buildAuthorityOverrideBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
      }),
    defaultCostTokens: 200,
    priority: "required",
  },
  {
    id: "persona-org-place",
    build: (ctx) =>
      buildPersonaAndOrgPlaceBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        priorContent: ctx.priorContent,
      }),
    defaultCostTokens: 250,
    priority: "required",
  },
  {
    id: "pending-tasks",
    build: (ctx) =>
      buildPendingTasksBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        priorContent: ctx.priorContent,
      }),
    defaultCostTokens: 200,
    priority: "skippable",
  },
  {
    id: "identity",
    build: (ctx) =>
      buildIdentityBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        priorContent: ctx.priorContent,
      }),
    defaultCostTokens: 150,
    priority: "required",
  },
  {
    id: "org-roster",
    build: (ctx) =>
      buildOrgRosterBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        isCeo: ctx.isCeo,
        priorContent: ctx.priorContent,
      }),
    defaultCostTokens: 800,
    priority: "required",
  },
  {
    id: "recent-activity",
    build: (ctx) =>
      buildRecentActivityBlock({
        orgId: ctx.orgId,
        isCeo: ctx.isCeo,
        priorContent: ctx.priorContent,
      }),
    defaultCostTokens: 600,
    priority: "skippable",
  },
  {
    id: "ceo-telegram-entry",
    build: (ctx) =>
      buildCeoTelegramEntryBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        isCeo: ctx.isCeo,
        priorContent: ctx.priorContent,
      }),
    defaultCostTokens: 600,
    priority: "required",
  },
  {
    id: "atlas-directives",
    build: (ctx) =>
      buildAtlasDirectivesBlock({
        isCeo: ctx.isCeo,
        priorContent: ctx.priorContent,
      }),
    defaultCostTokens: 2000,
    priority: "required",
  },
  // legacy-tail CHAT_BLOCKS entry removed phase 1e iter 19. The
  // wrapper buildAgentChatPreambleTail had become a no-op after all
  // emit sites were extracted (iter 1-17).
  {
    id: "json-commands-ceo",
    build: (ctx) =>
      buildCeoCommandsBlock({
        canCommand: ctx.canCommand,
        priorContent: ctx.priorContent,
      }),
    defaultCostTokens: 3000,
    priority: "required",
  },
  {
    id: "json-commands-composio",
    build: (ctx) =>
      buildSubAgentComposioCommandsBlock({
        canCommand: ctx.canCommand,
        hasComposio: ctx.hasComposio,
        priorContent: ctx.priorContent,
      }),
    defaultCostTokens: 1500,
    priority: "required",
  },
  {
    id: "past-memories",
    build: (ctx) =>
      buildPastMemoriesBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        priorContent: ctx.priorContent,
      }),
    defaultCostTokens: 400,
    priority: "skippable",
  },
  {
    id: "recent-reasoning",
    build: (ctx) =>
      buildRecentReasoningBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        priorContent: ctx.priorContent,
      }),
    defaultCostTokens: 400,
    priority: "skippable",
  },
  {
    id: "brand-profile",
    build: (ctx) =>
      buildBrandProfileBlock({
        orgId: ctx.orgId,
        orgName: ctx.orgName,
        isOwnerContext:
          ctx.userRole === "owner" || ctx.userRole === "admin",
        priorContent: ctx.priorContent,
      }),
    defaultCostTokens: 250,
    priority: "required",
  },
  {
    id: "agent-files",
    build: (ctx) =>
      buildAgentFilesBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        priorContent: ctx.priorContent,
      }),
    defaultCostTokens: 150,
    priority: "skippable",
  },
  {
    id: "company-corpus",
    build: (ctx) =>
      buildCompanyCorpusBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        queryText: ctx.queryText,
        priorContent: ctx.priorContent,
      }),
    defaultCostTokens: 600,
    priority: "skippable",
  },
  {
    id: "trailing-protocols",
    build: (ctx) => buildTrailingProtocolsBlock(ctx.priorContent),
    defaultCostTokens: 700,
    priority: "required",
  },
];

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
   * Opt-in console.info emission when the budget gate drops one or
   * more skippable blocks. Off by default to keep test output quiet
   * + parity surfaces silent. Chat route + telegram webhook enable
   * it so production logs show which blocks the budget cut.
   */
  telemetry?: boolean;
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

/**
 * Default role-aware budget. CEO agents get the biggest context
 * window (cross-org synthesis), dept heads get a mid tier (single
 * domain depth), specialists run lean. Values pinned per [B 17:26]
 * iter-35 spec - tweak in one place if telemetry shows headroom.
 */
export const ROLE_BASED_BUDGET_POLICY = (
  flags: AgentCapabilityFlags,
): number => {
  if (flags.isCeo) return 6000;
  if (flags.isDeptHead) return 4000;
  return 2000;
};

/**
 * Decide which CHAT_BLOCKS entries are eligible to render given the
 * caller-supplied budget. Required blocks always pass. Skippable
 * blocks are kept in registry order until the running total of
 * skippable cost exceeds skippableBudgetTokens; remaining skippable
 * blocks are dropped.
 *
 * Returned blocks preserve the original CHAT_BLOCKS order, so the
 * "priorContent" separator chain inside helpers keeps working.
 *
 * Default budget = Infinity -> returns CHAT_BLOCKS unchanged.
 */
export function selectChatBlocks(
  blocks: ChatBlock[] = CHAT_BLOCKS,
  options: ComposeChatPreambleOptions = {},
): ChatBlock[] {
  // Single source of truth: describeSelection owns the mode + budget
  // algorithm. selectChatBlocks projects its `selected` ids back onto
  // the input block objects, preserving registry order. Iter 34 DRY
  // collapse - the two used to maintain parallel filter logic.
  const selectedIds = new Set(
    describeSelection(blocks, options).selected.map((s) => s.id),
  );
  return blocks.filter((b) => selectedIds.has(b.id));
}

export type SelectionEntry = {
  id: string;
  priority: ChatBlockPriority;
  cost: number;
};

export type SkippedEntry = SelectionEntry & {
  reason: "mode" | "budget";
};

export type SelectionDecision = {
  selected: SelectionEntry[];
  skipped: SkippedEntry[];
  totalSelectedCost: number;
  totalSkippedCost: number;
};

/**
 * Pure debug helper. Mirrors the selectChatBlocks decision but also
 * reports which blocks were dropped and why (mode filter vs budget
 * cut). Useful for tests + production telemetry without paying the
 * cost of actually rendering anything.
 */
export function describeSelection(
  blocks: ChatBlock[] = CHAT_BLOCKS,
  options: ComposeChatPreambleOptions = {},
): SelectionDecision {
  const { mode } = options;
  const budget = options.skippableBudgetTokens ?? Number.POSITIVE_INFINITY;
  const budgetActive = Number.isFinite(budget) && budget >= 0;

  const selected: SelectionEntry[] = [];
  const skipped: SkippedEntry[] = [];
  let totalSelectedCost = 0;
  let totalSkippedCost = 0;
  let spent = 0;

  for (const b of blocks) {
    const priority = b.priority ?? "required";
    const cost = b.defaultCostTokens ?? 0;

    if (mode !== undefined && b.modes && !b.modes.includes(mode)) {
      skipped.push({ id: b.id, priority, cost, reason: "mode" });
      totalSkippedCost += cost;
      continue;
    }

    if (priority === "required") {
      selected.push({ id: b.id, priority, cost });
      totalSelectedCost += cost;
      continue;
    }

    // skippable + budget gate
    if (budgetActive && spent + cost > budget) {
      skipped.push({ id: b.id, priority, cost, reason: "budget" });
      totalSkippedCost += cost;
      continue;
    }
    spent += cost;
    selected.push({ id: b.id, priority, cost });
    totalSelectedCost += cost;
  }

  return { selected, skipped, totalSelectedCost, totalSkippedCost };
}

async function composeChatPreamble(
  input: Omit<ChatInput, "mode">,
  options: ComposeChatPreambleOptions = {},
  mode?: AgentContextMode,
): Promise<string> {
  const flags = await computeAgentCapabilityFlags({
    orgId: input.orgId,
    agentId: input.agentId,
  });
  const effectiveOptions: ComposeChatPreambleOptions = {
    ...options,
    mode: options.mode ?? mode,
  };
  // Iter 36: budgetPolicy (if set) overrides skippableBudgetTokens
  // using the already-computed flags - no extra DB round-trip.
  if (options.budgetPolicy) {
    effectiveOptions.skippableBudgetTokens = options.budgetPolicy(flags);
  }
  const decision = describeSelection(CHAT_BLOCKS, effectiveOptions);
  const selectedIds = new Set(decision.selected.map((s) => s.id));

  if (options.telemetry) {
    const budgetDrops = decision.skipped.filter((s) => s.reason === "budget");
    if (budgetDrops.length > 0) {
      const budget = effectiveOptions.skippableBudgetTokens;
      const budgetLabel = budget === undefined || !Number.isFinite(budget)
        ? "inf"
        : String(budget);
      console.info(
        `[chat-blocks-selector] mode=${
          effectiveOptions.mode ?? "any"
        } budget=${budgetLabel} dropped=${budgetDrops.length} ids=${budgetDrops
          .map((d) => d.id)
          .join(",")} tokens_saved=${budgetDrops.reduce(
          (sum, d) => sum + d.cost,
          0,
        )}`,
      );
    }
  }

  let out = "";
  for (const block of CHAT_BLOCKS) {
    if (!selectedIds.has(block.id)) continue;
    const piece = await block.build({
      ...input,
      ...flags,
      priorContent: out,
    });
    if (piece) out += piece;
  }
  return out;
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

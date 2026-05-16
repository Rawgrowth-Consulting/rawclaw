import {
  buildAgentChatPreamble,
  buildAgentChatPreambleTail,
  buildCapabilitiesAndTrustBlock,
  buildReasoningProtocolBlock,
  buildSharedMemoryBlock,
  buildRecentSignalsBlock,
  buildAssignedSkillsBlock,
  buildAuthorityOverrideBlock,
  buildPersonaAndOrgPlaceBlock,
  buildPendingTasksBlock,
  buildPastMemoriesBlock,
  buildRecentReasoningBlock,
  buildBrandProfileBlock,
  buildAgentFilesBlock,
  buildCompanyCorpusBlock,
  buildTrailingProtocolsBlock,
} from "./preamble";
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

export type ChatBlockContext = Omit<ChatInput, "mode"> & {
  priorContent: string;
};

export type ChatBlock = {
  id: string;
  build: (ctx: ChatBlockContext) => Promise<string | null> | string | null;
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
  },
  {
    id: "reasoning-protocol",
    build: () => buildReasoningProtocolBlock(),
  },
  {
    id: "shared-memory",
    build: (ctx) =>
      buildSharedMemoryBlock({ orgId: ctx.orgId, agentId: ctx.agentId }),
  },
  {
    id: "recent-signals",
    build: (ctx) => buildRecentSignalsBlock({ orgId: ctx.orgId }),
  },
  {
    id: "assigned-skills",
    build: (ctx) =>
      buildAssignedSkillsBlock({ orgId: ctx.orgId, agentId: ctx.agentId }),
  },
  {
    id: "authority-override",
    build: (ctx) =>
      buildAuthorityOverrideBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
      }),
  },
  {
    id: "persona-org-place",
    build: (ctx) =>
      buildPersonaAndOrgPlaceBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        priorContent: ctx.priorContent,
      }),
  },
  {
    id: "pending-tasks",
    build: (ctx) =>
      buildPendingTasksBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        priorContent: ctx.priorContent,
      }),
  },
  {
    id: "legacy-tail",
    build: (ctx) =>
      buildAgentChatPreambleTail({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        orgName: ctx.orgName,
        queryText: ctx.queryText,
        userRole: ctx.userRole,
        priorContent: ctx.priorContent,
      }),
  },
  {
    id: "past-memories",
    build: (ctx) =>
      buildPastMemoriesBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        priorContent: ctx.priorContent,
      }),
  },
  {
    id: "recent-reasoning",
    build: (ctx) =>
      buildRecentReasoningBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        priorContent: ctx.priorContent,
      }),
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
  },
  {
    id: "agent-files",
    build: (ctx) =>
      buildAgentFilesBlock({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        priorContent: ctx.priorContent,
      }),
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
  },
  {
    id: "trailing-protocols",
    build: (ctx) => buildTrailingProtocolsBlock(ctx.priorContent),
  },
];

async function composeChatPreamble(
  input: Omit<ChatInput, "mode">,
): Promise<string> {
  let out = "";
  for (const block of CHAT_BLOCKS) {
    const piece = await block.build({ ...input, priorContent: out });
    if (piece) out += piece;
  }
  return out;
}

export async function buildAgentContext(
  input: AgentContextInput,
): Promise<string> {
  switch (input.mode) {
    case "chat":
    case "telegram":
      return composeChatPreamble({
        orgId: input.orgId,
        agentId: input.agentId,
        orgName: input.orgName,
        queryText: input.queryText,
        userRole: input.userRole,
      });
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
): Promise<string> {
  return buildAgentContext({ mode: "chat", ...input });
}

export async function buildTelegramPreambleV2(
  input: Omit<ChatInput, "mode">,
): Promise<string> {
  return buildAgentContext({ mode: "telegram", ...input });
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

// `buildAgentChatPreamble` re-export so legacy callers can continue to
// import the monolithic entry point unchanged while the V2 wrappers
// run through the registry. Phase 2 flips the chat route to V2 +
// drops this re-export.
export { buildAgentChatPreamble };

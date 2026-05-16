import { buildAgentChatPreamble } from "./preamble";
import {
  buildSystemPrompt,
  type MemoryEntry,
  type InboxEntry,
} from "@/lib/runs/executor";
import type { RunContext } from "@/lib/runs/queries";

/**
 * DEEP WIN 4 phase 0 - unified agent context factory.
 *
 * Pure-delegation skeleton. Every mode forwards to the existing
 * legacy builder verbatim so the parity test in
 * tests/unit/context-parity.spec.ts can lock V1 == V2 byte-for-byte.
 *
 * NO behavior change in this phase. Phase 1 extracts a block
 * registry from preamble.ts and starts composing inside
 * buildAgentContext; phases 2-4 flip the chat / telegram / routine /
 * invoke callsites to the V2 wrappers and delete the legacy entry
 * points. Until then this file is a no-op wrapper that establishes
 * the API shape.
 *
 * Modes:
 *   chat | telegram - forward to buildAgentChatPreamble (preamble.ts
 *     comments call out that the chat route and the per-agent
 *     Telegram webhook share this surface).
 *   routine | invoke - forward to executor.buildSystemPrompt (the
 *     agent_invoke MCP tool creates a delegated run that runs through
 *     the same executor path).
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

export async function buildAgentContext(
  input: AgentContextInput,
): Promise<string> {
  switch (input.mode) {
    case "chat":
    case "telegram":
      return buildAgentChatPreamble({
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

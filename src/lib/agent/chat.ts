/**
 * chat.ts — v4 entry point. Delegates to the Hermes HTTP bridge by default,
 * with an env-flag fallback to the legacy v3 Anthropic SDK runner during
 * the migration window.
 *
 * Same signature as v3 so the Telegram webhook (`createStreamingEditor` +
 * heartbeat) and the dashboard NDJSON consumer keep working without code
 * changes downstream.
 *
 * Flip the engine via env:
 *   CHAT_ENGINE=hermes  (default on v4)
 *   CHAT_ENGINE=v3-sdk  (fallback to the in-process SDK runner)
 */

import { supabaseAdmin } from "@/lib/supabase/server";
import { buildAgentChatPreamble } from "@/lib/agent/preamble";
import { chatReplyViaSdk } from "@/lib/agent/chat-sdk";
import { chatReplyViaHermes } from "@/lib/hermes/bridge";

/** Keep this export — the Telegram webhook handler checks for it. */
export const CHAT_HANDOFF_SENTINEL_PREFIX =
  "[handoff] Give me a moment while I work on that";

type AgentChatResult =
  | { ok: true; reply: string }
  | { ok: false; error: string };

export interface ChatReplyInput {
  organizationId: string;
  organizationName: string | null;
  chatId: number;
  userMessage: string;
  publicAppUrl: string;
  agentId?: string;
  historyOverride?: Array<{ role: "user" | "assistant"; content: string }>;
  extraPreamble?: string;
  noHandoff?: boolean;
  maxTokens?: number;
  callerUserId?: string | null;
  onStreamText?: (text: string) => void;
  onToolUse?: (toolName: string) => void;
}

/**
 * Drop-in chatReply(). Builds the preamble (RAG + brand + memory)
 * exactly like v3, then routes to either Hermes (v4 default) or the
 * SDK runner (v3-sdk fallback).
 */
export async function chatReply(
  input: ChatReplyInput,
): Promise<AgentChatResult> {
  const {
    organizationId,
    organizationName,
    userMessage,
    agentId,
    extraPreamble: routeExtraPreamble,
  } = input;

  // Resolve agent: explicit agentId wins, else first non-paused agent
  let resolvedAgentId = agentId;
  if (!resolvedAgentId) {
    const { data } = await supabaseAdmin()
      .from("rgaios_agents")
      .select("id")
      .eq("organization_id", organizationId)
      .neq("status", "paused")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    resolvedAgentId = (data as { id?: string } | null)?.id;
    if (!resolvedAgentId) {
      return {
        ok: false,
        error: "No agents configured for this organization.",
      };
    }
  }

  // Build the existing preamble (RAG, brand voice, shared memory, etc.)
  // from the v3 preamble builder so all the context stays intact.
  let fullExtraPreamble = "";
  try {
    const preambleContext = await buildAgentChatPreamble({
      orgId: organizationId,
      agentId: resolvedAgentId,
      orgName: organizationName,
      queryText: userMessage,
    });
    if (preambleContext) fullExtraPreamble += preambleContext;
  } catch (err) {
    console.warn(
      "[chat] preamble build failed:",
      (err as Error).message,
    );
  }
  if (routeExtraPreamble) {
    fullExtraPreamble += "\n\n" + routeExtraPreamble;
  }

  const merged: ChatReplyInput = {
    ...input,
    agentId: resolvedAgentId,
    extraPreamble: fullExtraPreamble || undefined,
  };

  const engine = process.env.CHAT_ENGINE?.trim() || "hermes";
  if (engine === "v3-sdk") {
    return chatReplyViaSdk(merged);
  }
  return chatReplyViaHermes(merged);
}

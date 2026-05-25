/**
 * Hermes bridge — translates the existing `chatReply()` contract to the
 * Hermes HTTP gateway. Same signature, same return shape, same callback
 * cadence so the Telegram streaming editor and the dashboard NDJSON
 * consumer don't need to change.
 *
 * On the v3 stack, chatReply() called chatReplyViaSdk() which spawned
 * the Anthropic SDK runner locally. On v4 it calls hermesResponses()
 * over HTTP against the on-VPS Hermes gateway. Hermes spawns tools,
 * sub-agents and Composio calls natively; the bridge just streams the
 * SSE events back into the existing onStreamText / onToolUse hooks.
 */

import { supabaseAdmin } from "@/lib/supabase/server";
import { hermesResponses, type HermesEvent } from "@/lib/hermes/client";

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
 * Drop-in replacement for the v3 chatReply(). Routes to Hermes gateway
 * via HTTP + SSE. Profile resolution: agentId -> rgaios_agents.name ->
 * Hermes profile name (lowercased, underscored). If no profile matches
 * server-side, Hermes falls back to its default profile.
 */
export async function chatReplyViaHermes(
  input: ChatReplyInput,
): Promise<AgentChatResult> {
  const {
    organizationId,
    organizationName,
    userMessage,
    agentId,
    chatId,
    publicAppUrl,
    extraPreamble: routeExtraPreamble,
    onStreamText,
    onToolUse,
  } = input;

  // Resolve agent: explicit agentId wins, else first non-paused agent
  let resolvedAgentId = agentId;
  let agentName: string | undefined;
  if (resolvedAgentId) {
    const { data } = await supabaseAdmin()
      .from("rgaios_agents")
      .select("name")
      .eq("id", resolvedAgentId)
      .maybeSingle();
    agentName = (data as { name?: string } | null)?.name ?? undefined;
  } else {
    const { data } = await supabaseAdmin()
      .from("rgaios_agents")
      .select("id, name")
      .eq("organization_id", organizationId)
      .neq("status", "paused")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const row = data as { id?: string; name?: string } | null;
    resolvedAgentId = row?.id;
    agentName = row?.name ?? undefined;
  }

  if (!resolvedAgentId) {
    return {
      ok: false,
      error: `No agent found for organization ${organizationId}.`,
    };
  }

  // chat.ts upstream has already built the RAG + brand + memory preamble
  // and passed it through `extraPreamble`. We just stitch it onto the
  // user message before sending to Hermes.
  void organizationName;
  void publicAppUrl;
  const fullPrompt = routeExtraPreamble
    ? `${routeExtraPreamble}\n\n---\n\n${userMessage}`
    : userMessage;

  const profile = agentName ? toProfileName(agentName) : undefined;
  const conversation = `org:${organizationId}:chat:${chatId}`;

  // Translate Hermes events -> existing onStreamText / onToolUse callbacks
  // so the Telegram streaming editor + AgentChatTab consumer keep their
  // existing event cadence.
  let accumulated = "";
  const onEvent = (event: HermesEvent) => {
    switch (event.type) {
      case "text_delta":
        accumulated += event.text;
        onStreamText?.(accumulated);
        break;
      case "tool_call_start":
        onToolUse?.(event.name);
        break;
      case "spawn_agent":
        onToolUse?.(`spawn:${event.profile}`);
        break;
      case "done":
        accumulated = event.final_text || accumulated;
        onStreamText?.(accumulated);
        break;
      case "error":
        // surfaced via the throw inside hermesResponses, no-op here
        break;
      default:
        break;
    }
  };

  try {
    const result = await hermesResponses({
      prompt: fullPrompt,
      profile,
      conversation,
      stream: true,
      onEvent,
    });

    // Write-back mirror so the dashboard's existing reader keeps working
    // until we refactor AgentChatTab to read Hermes conversation history
    // directly. Best-effort; if Supabase write fails the chat still went
    // through and the user has the reply.
    await supabaseAdmin()
      .from("rgaios_agent_chat_messages")
      .insert([
        {
          organization_id: organizationId,
          agent_id: resolvedAgentId,
          chat_id: chatId,
          role: "user",
          content: userMessage,
        },
        {
          organization_id: organizationId,
          agent_id: resolvedAgentId,
          chat_id: chatId,
          role: "assistant",
          content: result.reply,
          metadata: { engine: "hermes", profile },
        },
      ])
      .then(() => null)
      .catch((err: unknown) => {
        console.warn("[hermes-bridge] chat mirror failed:", err);
      });

    return { ok: true, reply: result.reply };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Lowercase + underscore + strip non-alphanumerics. Mirrors how the
 * Hermes deploy script registers profiles from rgaios_agents.name.
 * "Scan" -> "scan", "Engineering Manager" -> "engineering_manager",
 * "Kasia" -> "kasia".
 */
function toProfileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Hermes bridge — adapts the v3 chatReply() contract to the Hermes
 * dashboard's JSON-RPC WebSocket chat surface on /api/ws. Same signature,
 * same return shape, same callback cadence so the Telegram streaming
 * editor + dashboard NDJSON consumer keep working unchanged.
 */

import { supabaseAdmin } from "@/lib/supabase/server";
import { hermesChat, type HermesChatEvent } from "@/lib/hermes/client";

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
 * Drop-in replacement for v3 chatReply(). Routes to Hermes via WS /api/ws.
 *
 * Profile resolution: agentId -> rgaios_agents.name -> profile name
 * (lowercase + underscored). If no profile matches server-side, Hermes
 * falls back to the default profile configured via HERMES_DEFAULT_PROFILE.
 *
 * Session resolution: deterministic id `org:<orgId>:chat:<chatId>` so
 * Hermes can attach to a long-running conversation per (org, chat) pair
 * and preserve memory across turns.
 */
export async function chatReplyViaHermes(
  input: ChatReplyInput,
): Promise<AgentChatResult> {
  const {
    organizationId,
    userMessage,
    agentId,
    chatId,
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
  // and passed it through `extraPreamble`. We stitch it onto the user
  // message before sending to Hermes; Hermes treats the whole thing as
  // one user-side input and the profile soul (system_prompt) provides
  // the agent persona on the Hermes side.
  const fullPrompt = routeExtraPreamble
    ? `${routeExtraPreamble}\n\n---\n\n${userMessage}`
    : userMessage;

  const profile = agentName ? toProfileName(agentName) : undefined;
  const session = `org:${organizationId}:chat:${chatId}`;

  let accumulated = "";
  const onEvent = (event: HermesChatEvent) => {
    switch (event.type) {
      case "text_delta":
        accumulated += event.text;
        onStreamText?.(accumulated);
        break;
      case "tool_call_start":
        onToolUse?.(event.name);
        break;
      case "done":
        accumulated = event.final_text || accumulated;
        onStreamText?.(accumulated);
        break;
      default:
        break;
    }
  };

  try {
    const result = await hermesChat({
      prompt: fullPrompt,
      profile,
      session,
      onEvent,
    });

    // Write-back mirror so the dashboard's existing reader keeps working
    // until we refactor AgentChatTab to read from Hermes /api/sessions
    // directly. Best-effort.
    void supabaseAdmin()
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
          metadata: { engine: "hermes", profile, session },
        },
      ])
      .then(() => null);

    return { ok: true, reply: result.reply };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Lowercase + underscore + strip non-alphanumerics. Mirrors how the
 * sync-hermes-profiles script registers profiles from rgaios_agents.name.
 *   "Scan" -> "scan"
 *   "Engineering Manager" -> "engineering_manager"
 *   "Kasia" -> "kasia"
 */
function toProfileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

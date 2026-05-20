/**
 * chat-bridge.ts — Bridge between the existing route interface and the new
 * Agent SDK runner. Exports a `chatReply()` with the same signature the
 * routes currently call, but internally delegates to chatReplyViaSdk().
 *
 * Drop this in as `src/lib/agent/chat.ts` to replace the old implementation.
 * The routes don't need to change — same function name, same input/output shape.
 */

import { supabaseAdmin } from "@/lib/supabase/server";
import { buildAgentChatPreamble } from "@/lib/agent/preamble";
import { chatReplyViaSdk } from "@/lib/agent/chat-sdk";

/** Keep this export — the Telegram webhook handler checks for it. */
export const CHAT_HANDOFF_SENTINEL_PREFIX =
  "[handoff] Give me a moment while I work on that";

type AgentChatResult =
  | { ok: true; reply: string }
  | { ok: false; error: string };

/**
 * Drop-in replacement for the old chatReply(). Same signature, same return type.
 * Internally uses the Agent SDK instead of direct API calls.
 */
export async function chatReply(input: {
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
}): Promise<AgentChatResult> {
  const {
    organizationId,
    organizationName,
    userMessage,
    agentId,
    extraPreamble: routeExtraPreamble,
  } = input;

  // If no agentId, use the org's first agent
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
    resolvedAgentId = data?.id;
    if (!resolvedAgentId) {
      return { ok: false, error: "No agents configured for this organization." };
    }
  }

  // Build the extra preamble (RAG, brand voice, shared memory, signals, etc.)
  // from the existing preamble builder. This injects brand context, agent files,
  // company corpus, shared memory — all the good context stuff from v3.
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
    console.warn("[chat-bridge] preamble build failed:", (err as Error).message);
  }

  // Append any route-specific extra preamble
  if (routeExtraPreamble) {
    fullExtraPreamble += "\n\n" + routeExtraPreamble;
  }

  // Delegate to the SDK runner
  const result = await chatReplyViaSdk({
    organizationId,
    organizationName,
    userMessage,
    agentId: resolvedAgentId,
    extraPreamble: fullExtraPreamble || undefined,
    publicAppUrl: input.publicAppUrl,
    onStreamText: input.onStreamText,
    onToolUse: input.onToolUse,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, reply: result.reply };
}

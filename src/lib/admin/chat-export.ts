import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Chat-trace export data access helper.
 *
 * The "chat" in this product is per-agent: every row in
 * rgaios_agent_chat_messages is keyed by agent_id + ordered by
 * created_at. Exporting a "chat" = exporting that agent's full
 * conversation transcript for the active org.
 *
 * Reasoning, tool_calls, tool_results, and other per-turn extras
 * live in the message metadata JSON. We surface them flat in the
 * exported shape so downstream tooling (audit, debug, customer
 * receipts) doesn't need to crack open the metadata blob.
 */

export type ExportedMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  reasoning: string | null;
  tool_calls: unknown[] | null;
  tool_results: unknown[] | null;
  metadata: Record<string, unknown>;
};

export type ExportedTrace = {
  chatId: string; // agent id
  organizationId: string;
  exportedAt: string;
  messageCount: number;
  messages: ExportedMessage[];
};

type ChatMessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

function pickArray(meta: Record<string, unknown>, key: string): unknown[] | null {
  const v = meta[key];
  return Array.isArray(v) ? v : null;
}

function pickString(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function flattenMessage(row: ChatMessageRow): ExportedMessage {
  const meta = row.metadata ?? {};
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    created_at: row.created_at,
    reasoning: pickString(meta, "reasoning") ?? pickString(meta, "thinking"),
    tool_calls: pickArray(meta, "tool_calls") ?? pickArray(meta, "toolCalls"),
    tool_results: pickArray(meta, "tool_results") ?? pickArray(meta, "toolResults"),
    metadata: meta,
  };
}

/**
 * Loads every chat message for the (orgId, agentId) pair ordered by
 * created_at. Caller is responsible for the admin gate; the orgId
 * is pinned from the verified session.
 */
export async function loadChatTraceForExport(
  orgId: string,
  agentId: string,
): Promise<{ trace: ExportedTrace; error?: string }> {
  const empty: ExportedTrace = {
    chatId: agentId,
    organizationId: orgId,
    exportedAt: new Date().toISOString(),
    messageCount: 0,
    messages: [],
  };

  const { data, error } = await supabaseAdmin()
    .from("rgaios_agent_chat_messages")
    .select("id, role, content, created_at, metadata")
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: true })
    .limit(10_000);

  if (error) {
    return { trace: empty, error: error.message };
  }

  const rows = (data ?? []) as ChatMessageRow[];
  const messages = rows.map(flattenMessage);

  return {
    trace: {
      ...empty,
      messageCount: messages.length,
      messages,
    },
  };
}

/**
 * Returns true iff the chatId looks like a uuid. Used to reject
 * malformed export URLs at the API boundary before we touch
 * Supabase.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isChatId(s: string): boolean {
  return UUID_RE.test(s);
}

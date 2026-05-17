import { supabaseAdmin } from "@/lib/supabase/server";

import type {
  ChatTelemetryCallback,
  ChatTelemetryDecisionPayload,
} from "./context";

/**
 * Identity scope for a single composeChatPreamble call. orgId is
 * required (RLS key); agentId is optional because some preamble
 * builds happen before an agent is bound (e.g. owner-chat onboarding
 * stub). messageCount is the chat-history depth at decision time so
 * the admin page can correlate "this row was at message 38" with the
 * 0.5x history scale that fired.
 */
export type PersistChatTelemetryScope = {
  orgId: string;
  agentId?: string | null;
  messageCount?: number;
};

/**
 * Returns a ChatTelemetryCallback that writes one row to
 * rgaios_chat_telemetry per composeChatPreamble decision. Uses
 * supabaseAdmin (service role) so it bypasses RLS; org isolation
 * comes from the orgId we pin from the scope, not the JWT.
 *
 * The composer fires this without awaiting (see context.ts
 * Promise.resolve(...).catch path). On insert failure we log and
 * swallow; telemetry must never break chat.
 */
export function persistChatTelemetry(
  scope: PersistChatTelemetryScope,
): ChatTelemetryCallback {
  return async (decision: ChatTelemetryDecisionPayload) => {
    const row = {
      organization_id: scope.orgId,
      agent_id: scope.agentId ?? null,
      mode: decision.mode ?? "unknown",
      selected_block_ids: decision.selectedIds,
      skipped_block_ids: decision.skippedIds,
      estimated_tokens: decision.estimatedTokens,
      budget_tokens: decision.budgetTokens,
      skipped_by_budget: decision.skippedByBudget,
      role_flags: decision.roleFlags,
      message_count: scope.messageCount ?? null,
    };
    // rgaios_chat_telemetry landed in migration 0076; generated
    // Supabase types regenerate on the next typegen pass, so until
    // then the row payload is cast through `never` (same pattern as
    // agent-messaging.ts uses for rgaios_agent_messages).
    const { error } = await supabaseAdmin()
      .from("rgaios_chat_telemetry")
      .insert(row as never);
    if (error) {
      console.error("[chat-telemetry] insert failed", error);
    }
  };
}

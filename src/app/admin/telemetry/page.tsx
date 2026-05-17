import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { TelemetryClient } from "./Client";

export const dynamic = "force-dynamic";

/**
 * F-5: admin telemetry page. Surfaces the last 100
 * composeChatPreamble decisions persisted by persistChatTelemetry
 * (see src/lib/agent/telemetry.ts). Answers "why was block X
 * skipped for agent Y at 22:14" without re-running the agent.
 */
export default async function AdminTelemetryPage() {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin) redirect("/auth/signin");

  const { data: rows } = await supabaseAdmin()
    .from("rgaios_chat_telemetry" as never)
    .select(
      "id, agent_id, mode, selected_block_ids, skipped_block_ids, estimated_tokens, budget_tokens, skipped_by_budget, message_count, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <PageShell
      title="Chat telemetry"
      description="Recent preamble selector decisions. Each row is one composeChatPreamble call: which blocks landed, which got cut by the budget gate, and the cap that made the call."
    >
      <TelemetryClient initial={(rows as TelemetryRow[] | null) ?? []} />
    </PageShell>
  );
}

// Shared row shape — keep in sync with Client.tsx import.
export type TelemetryRow = {
  id: string;
  agent_id: string | null;
  mode: string;
  selected_block_ids: string[];
  skipped_block_ids: string[];
  estimated_tokens: number;
  budget_tokens: number;
  skipped_by_budget: boolean;
  message_count: number | null;
  created_at: string;
};

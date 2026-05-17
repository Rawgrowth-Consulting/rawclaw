import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import {
  fetchRecentChatTelemetry,
  type ChatTelemetryRow,
} from "@/lib/agent/telemetry";
import { TelemetryClient } from "./Client";

export const dynamic = "force-dynamic";

export type TelemetryRow = ChatTelemetryRow;

/**
 * F-5: admin telemetry page. Surfaces the last 100
 * composeChatPreamble decisions persisted by persistChatTelemetry
 * (see src/lib/agent/telemetry.ts). Answers "why was block X
 * skipped for agent Y at 22:14" without re-running the agent.
 */
export default async function AdminTelemetryPage() {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin) redirect("/auth/signin");

  const { rows } = await fetchRecentChatTelemetry({ limit: 100 });

  return (
    <PageShell
      title="Chat telemetry"
      description="Recent preamble selector decisions. Each row is one composeChatPreamble call: which blocks landed, which got cut by the budget gate, and the cap that made the call."
    >
      <TelemetryClient initial={rows} />
    </PageShell>
  );
}

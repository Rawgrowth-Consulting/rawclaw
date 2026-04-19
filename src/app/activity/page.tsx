import { Activity } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";

export default function ActivityPage() {
  return (
    <PageShell
      title="Activity"
      description="Audit log of every agent run, tool call, and decision across the company."
    >
      <EmptyState
        icon={Activity}
        title="No activity recorded"
        description="Agent runs, heartbeats, tool calls, and approvals will appear here as they happen. Every action is traced."
      />
    </PageShell>
  );
}

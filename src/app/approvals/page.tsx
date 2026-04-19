import { ShieldCheck } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";

export default function ApprovalsPage() {
  return (
    <PageShell
      title="Approvals"
      description="Human-in-the-loop decisions. Your agents ask, you approve."
    >
      <EmptyState
        icon={ShieldCheck}
        title="Nothing to approve"
        description="When agents need to spend money, send external messages, or take high-risk actions, they'll request approval here."
      />
    </PageShell>
  );
}

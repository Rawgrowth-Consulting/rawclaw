import { Inbox } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";

export default function InboxPage() {
  return (
    <PageShell
      title="Inbox"
      description="Messages, mentions, approvals, and join requests from your agents."
    >
      <EmptyState
        icon={Inbox}
        title="Inbox zero"
        description="When your agents escalate decisions, request approvals, or mention you in tickets, they'll land here."
      />
    </PageShell>
  );
}

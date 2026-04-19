import { CircleDot } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function IssuesPage() {
  return (
    <PageShell
      title="Issues"
      description="Every conversation, task, and decision is an issue. Traced end-to-end."
      actions={
        <Button size="sm" className="btn-shine bg-primary text-white hover:bg-primary/90">
          New issue
        </Button>
      }
    >
      <EmptyState
        icon={CircleDot}
        title="No issues yet"
        description="Create an issue to give an agent work. Issues capture the conversation, the tools used, and the outcome."
        action={
          <Button size="sm" className="btn-shine bg-primary text-white hover:bg-primary/90">
            Create first issue
          </Button>
        }
      />
    </PageShell>
  );
}

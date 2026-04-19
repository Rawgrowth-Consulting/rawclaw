import { Target } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function GoalsPage() {
  return (
    <PageShell
      title="Goals"
      description="Your company mission broken into measurable goals that agents align against."
      actions={
        <Button size="sm" className="btn-shine bg-primary text-white hover:bg-primary/90">
          New goal
        </Button>
      }
    >
      <EmptyState
        icon={Target}
        title="No goals defined"
        description="Every agent task traces back to a goal. Set a mission and break it into sub-goals to give your agents context."
      />
    </PageShell>
  );
}

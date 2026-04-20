import { Building2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";

export const metadata = {
  title: "Departments — Rawgrowth",
};

export default function DepartmentsPage() {
  return (
    <PageShell
      title="Departments"
      description="Group your agents into departments that mirror your business pillars."
    >
      <EmptyState
        icon={Building2}
        title="Departments coming soon"
        description="Organize agents into Marketing, Sales, Fulfilment, and Finance teams. Departments map to your Dashboard pillars, so metrics and ownership stay aligned."
      />
    </PageShell>
  );
}

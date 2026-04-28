import { PageShell } from "@/components/page-shell";
import { DepartmentsView } from "@/components/departments/departments-view";

export const metadata = {
  title: "Departments — Rawgrowth",
};

export default function DepartmentsPage() {
  return (
    <PageShell
      title="Departments"
      description="Organize your agents by business pillar. Every agent can belong to Marketing, Sales, Fulfilment, or Finance — or stay unassigned."
    >
      <DepartmentsView />
    </PageShell>
  );
}

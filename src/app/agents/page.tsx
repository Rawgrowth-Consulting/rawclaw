import { PageShell } from "@/components/page-shell";
import { OrgChart } from "@/components/org-chart";

export default function AgentsPage() {
  return (
    <PageShell
      title="Agents"
      description="Your AI employees, organized as an org chart. Click any agent to edit."
    >
      <OrgChart />
    </PageShell>
  );
}

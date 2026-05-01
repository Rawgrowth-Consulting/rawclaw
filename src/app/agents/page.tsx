import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { AgentSheet } from "@/components/agent-sheet";
import { AgentsByDeptView } from "@/components/agents-by-dept-view";
import { getOrgContext } from "@/lib/auth/admin";
import { listAgentsForOrg } from "@/lib/agents/queries";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");
  const agents = await listAgentsForOrg(ctx.activeOrgId);

  return (
    <PageShell
      title="Agents"
      description="Your AI employees, grouped by department. Atlas runs the show; press Hire to add anyone underneath."
      actions={<AgentSheet triggerLabel="+ Hire agent" triggerSize="sm" />}
    >
      <AgentsByDeptView agents={agents} />
    </PageShell>
  );
}

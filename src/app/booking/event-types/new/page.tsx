import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { listAgentsForOrg } from "@/lib/agents/queries";
import { EventTypeForm } from "../EventTypeForm";

export const dynamic = "force-dynamic";

export default async function NewEventTypePage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");
  const agents = await listAgentsForOrg(ctx.activeOrgId);
  return (
    <PageShell title="New event type" description="Define a bookable slot.">
      <EventTypeForm
        agents={agents.map((a) => ({
          id: a.id,
          name: a.name,
          department: a.department ?? null,
        }))}
      />
    </PageShell>
  );
}

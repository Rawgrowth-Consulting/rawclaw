import { notFound, redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { getEventTypeById } from "@/lib/booking/queries";
import { listAgentsForOrg } from "@/lib/agents/queries";
import { EventTypeForm } from "../EventTypeForm";

export const dynamic = "force-dynamic";

export default async function EditEventTypePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  const evt = await getEventTypeById(ctx.activeOrgId, id);
  if (!evt) notFound();

  const agents = await listAgentsForOrg(ctx.activeOrgId);

  return (
    <PageShell title={`Edit: ${evt.title}`} description="Tune scheduling rules and pin to an agent.">
      <EventTypeForm
        agents={agents.map((a) => ({
          id: a.id,
          name: a.name,
          department: a.department ?? null,
        }))}
        initial={{
          id: evt.id,
          slug: evt.slug,
          title: evt.title,
          description: evt.description,
          durationMinutes: evt.durationMinutes,
          bufferBeforeMin: evt.rules.bufferBeforeMin,
          bufferAfterMin: evt.rules.bufferAfterMin,
          minNoticeMinutes: evt.rules.minNoticeMinutes,
          maxAdvanceDays: evt.rules.maxAdvanceDays,
          maxBookingsPerDay: evt.rules.maxBookingsPerDay,
          active: evt.active,
          agentId: evt.agentId,
          locationType: evt.location.type,
          phoneNumber: evt.location.type === "phone" ? evt.location.phoneNumber : "",
          customText: evt.location.type === "custom" ? evt.location.customText : "",
        }}
      />
    </PageShell>
  );
}

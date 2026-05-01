import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { getAvailability } from "@/lib/booking/queries";
import { AvailabilityEditor } from "./AvailabilityEditor";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");
  const availability = await getAvailability(ctx.activeOrgId);
  return (
    <PageShell
      title="Availability"
      description="Weekly hours guests can book against."
    >
      <AvailabilityEditor
        initial={{
          timezone: availability.timezone,
          weeklyHours: availability.weeklyHours,
        }}
      />
    </PageShell>
  );
}

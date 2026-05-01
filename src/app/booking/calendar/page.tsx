import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { CalendarBindingForm } from "./CalendarBindingForm";

export const dynamic = "force-dynamic";

export default async function CalendarBindingPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");
  return (
    <PageShell
      title="Calendar binding"
      description="Pick which Google Calendar bookings should land in. Connect Google Calendar in Connections first."
    >
      <CalendarBindingForm />
    </PageShell>
  );
}

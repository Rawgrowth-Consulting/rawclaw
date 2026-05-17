import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import {
  fetchAgentHeatmap,
  HEATMAP_DEFAULT_WINDOW,
  type HeatmapPayload,
} from "@/lib/agent/heatmap";
import { HeatmapClient } from "./Client";

export const dynamic = "force-dynamic";

export type ActivityHeatmapPayload = HeatmapPayload;

/**
 * F-9: admin chat-activity heatmap. 7 days back × 24 hours per
 * agent, top 10 agents by turn count. Cells colored by relative
 * intensity within the page so a quiet org still gets a readable
 * grid.
 *
 * Data source: rgaios_chat_telemetry (F-5 migration 0076). Until
 * F-5 lands, the fetch helper returns an empty agents list so the
 * page renders an empty-state explanation instead of throwing.
 */
export default async function AdminHeatmapPage() {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin || !ctx.activeOrgId) redirect("/auth/signin");

  const tz =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const initial = await fetchAgentHeatmap(
    ctx.activeOrgId,
    tz,
    HEATMAP_DEFAULT_WINDOW,
  );

  return (
    <PageShell
      title="Agent activity heatmap"
      description={`Per-agent chat-turn density bucketed by day-of-week × hour-of-day in ${tz}. Switch the 7d / 30d / 90d window above. Top 10 agents by total turns.`}
    >
      <HeatmapClient initial={initial} timezone={tz} />
    </PageShell>
  );
}

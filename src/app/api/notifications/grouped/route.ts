import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  groupNotifications,
  totalUnread,
  type BellNotification,
} from "@/lib/notifications/grouping";

export const runtime = "nodejs";

/**
 * GET /api/notifications/grouped
 *
 * F-2 variant of the bell payload. Returns the same source rows as
 * /api/notifications/agents but bucketed by metadata.kind so the
 * dropdown can section the list (Coordination | Anomaly | Data
 * ask | Message) and the badge can show the total unread count
 * across all groups in one shot.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin()
    .from("rgaios_agent_chat_messages")
    .select("id, agent_id, content, created_at, metadata")
    .eq("organization_id", orgId)
    .eq("role", "assistant")
    .gte("created_at", since)
    .or("metadata->>archived.is.null,metadata->>archived.eq.false")
    .filter(
      "metadata->>kind",
      "in",
      "(proactive_anomaly,data_ask,atlas_coordinate)",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    agent_id: string;
    content: string;
    created_at: string;
    metadata: Record<string, unknown> | null;
  };
  const rows = (data ?? []) as Row[];

  const agentIds = Array.from(new Set(rows.map((r) => r.agent_id)));
  const nameById = new Map<string, string>();
  if (agentIds.length > 0) {
    const { data: agents } = await supabaseAdmin()
      .from("rgaios_agents")
      .select("id, name")
      .in("id", agentIds);
    for (const a of (agents ?? []) as Array<{ id: string; name: string }>) {
      nameById.set(a.id, a.name);
    }
  }

  const flat: BellNotification[] = rows.map((r) => ({
    id: r.id,
    agent_id: r.agent_id,
    agent_name: nameById.get(r.agent_id) ?? "Agent",
    content: r.content,
    created_at: r.created_at,
    kind:
      (r.metadata as { kind?: string } | null)?.kind ?? "message",
  }));

  const groups = groupNotifications(flat);
  return NextResponse.json({
    groups,
    unread: totalUnread(groups),
  });
}

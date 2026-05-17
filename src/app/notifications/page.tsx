import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  groupNotifications,
  labelForKind,
  type BellNotification,
  type NotificationKind,
} from "@/lib/notifications/grouping";
import { humanizeJargon } from "@/lib/agent/jargon";

export const dynamic = "force-dynamic";

/**
 * F-2 "see all" page. Same source as the bell, no 5-per-group cap.
 * Sectioned by kind; flat enough that the operator can scan a
 * week without paging. Pagination is v2 if the volume ever
 * outgrows the 50-row cap.
 */
export default async function NotificationsPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");
  const orgId = ctx.activeOrgId;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabaseAdmin()
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
    .limit(200);

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
  // 200-cap latest per group so the full page can scroll a week
  // without truncation.
  const groups = groupNotifications(flat).map((g) => ({
    ...g,
    latest: flat.filter((n) => (n.kind as NotificationKind) === g.kind),
  }));

  return (
    <PageShell
      title="Notifications"
      description="All recent agent notifications across kinds, last 7 days. Sectioned by kind."
    >
      {groups.length === 0 ? (
        <p className="rounded border border-border p-6 text-sm text-muted-foreground">
          No notifications in the last 7 days.
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.kind} className="rounded border border-border">
              <header className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
                <span className="text-sm font-semibold">
                  {labelForKind(g.kind)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {g.latest.length}
                </span>
              </header>
              <ul>
                {g.latest.map((n) => (
                  <li
                    key={n.id}
                    className="border-t border-border px-3 py-2 text-sm first:border-t-0"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold">{n.agent_name}</span>
                      <span className="font-mono text-muted-foreground">
                        {new Date(n.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {humanizeJargon(n.content)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </PageShell>
  );
}

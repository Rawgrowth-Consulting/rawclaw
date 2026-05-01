import { notFound, redirect } from "next/navigation";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { listConnectionsForOrg } from "@/lib/connections/queries";
import { SKILLS_CATALOG } from "@/lib/skills/catalog";
import { AgentPanelClient } from "./AgentPanelClient";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");
  const orgId = ctx.activeOrgId;
  const db = supabaseAdmin();

  const { data: agent } = await db
    .from("rgaios_agents")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agent) notFound();

  // Memory: last 20 entries from audit_log keyed by detail->>'agent_id'.
  const { data: memory } = await db
    .from("rgaios_audit_log")
    .select("id, ts, kind, actor_type, actor_id, detail")
    .eq("organization_id", orgId)
    .filter("detail->>agent_id", "eq", id)
    .order("ts", { ascending: false })
    .limit(20);

  // Tasks: last 50 routine runs whose routine assigned this agent.
  const { data: tasks } = await db
    .from("rgaios_routine_runs")
    .select("id, status, source, started_at, completed_at, error, routine_id")
    .eq("organization_id", orgId)
    .in("routine_id", (
      await db
        .from("rgaios_routines")
        .select("id")
        .eq("organization_id", orgId)
        .eq("assignee_agent_id", id)
    ).data?.map((r) => (r as { id: string }).id) ?? [])
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(50);

  // Telegram connection status for this agent.
  const { data: telegram } = await db
    .from("rgaios_connections")
    .select("status, display_name, metadata")
    .eq("organization_id", orgId)
    .eq("agent_id", id)
    .eq("provider_config_key", "telegram")
    .maybeSingle();

  // Files attached to this agent (brief §7 per-agent panel).
  const { data: files } = await db
    .from("rgaios_agent_files")
    .select("id, filename, mime_type, size_bytes, uploaded_at")
    .eq("organization_id", orgId)
    .eq("agent_id", id)
    .order("uploaded_at", { ascending: false })
    .limit(100);

  // Vision tab data: skills wired to this agent + direct reports + org-wide
  // connectors visible.
  const { data: skillRows } = await db
    .from("rgaios_agent_skills")
    .select("skill_id")
    .eq("organization_id", orgId)
    .eq("agent_id", id);
  const skills = (skillRows ?? [])
    .map((r) => SKILLS_CATALOG.find((s) => s.id === (r as { skill_id: string }).skill_id))
    .filter((s): s is (typeof SKILLS_CATALOG)[number] => !!s)
    .map((s) => ({ id: s.id, name: s.name, category: s.category, tagline: s.tagline }));

  const { data: directReportsRaw } = await db
    .from("rgaios_agents")
    .select("id, name, role, department")
    .eq("organization_id", orgId)
    .eq("reports_to", id)
    .order("name", { ascending: true });
  const directReports = (directReportsRaw ?? []).map((r) => ({
    id: (r as { id: string }).id,
    name: (r as { name: string }).name,
    role: (r as { role: string }).role,
    department: (r as { department: string | null }).department,
  }));

  let reportsToAgent: { id: string; name: string; role: string } | null = null;
  if ((agent as { reports_to: string | null }).reports_to) {
    const { data: parent } = await db
      .from("rgaios_agents")
      .select("id, name, role")
      .eq("id", (agent as { reports_to: string }).reports_to)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (parent) {
      reportsToAgent = {
        id: (parent as { id: string }).id,
        name: (parent as { name: string }).name,
        role: (parent as { role: string }).role,
      };
    }
  }

  const orgConnections = await listConnectionsForOrg(orgId);
  const connectors = orgConnections
    .filter((c) => c.status === "connected")
    .map((c) => ({
      providerConfigKey: c.provider_config_key,
      displayName: c.display_name ?? c.provider_config_key,
    }));

  return (
    <AgentPanelClient
      agent={agent as unknown as Parameters<typeof AgentPanelClient>[0]["agent"]}
      memory={memory ?? []}
      tasks={tasks ?? []}
      telegram={
        (telegram as unknown as Parameters<typeof AgentPanelClient>[0]["telegram"]) ?? null
      }
      files={files ?? []}
      skills={skills}
      directReports={directReports}
      reportsToAgent={reportsToAgent}
      connectors={connectors}
    />
  );
}

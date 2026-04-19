import { NextResponse } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const orgId = await currentOrganizationId();
  const db = supabaseAdmin();

  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [agentsRes, failedRunsRes, approvalsRes, spendRes] = await Promise.all([
    db
      .from("rgaios_agents")
      .select("id, status", { count: "exact" })
      .eq("organization_id", orgId),
    db
      .from("rgaios_routine_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "failed")
      .gte("created_at", sevenDaysAgo),
    db
      .from("rgaios_approvals")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "pending"),
    db
      .from("rgaios_agents")
      .select("spent_monthly_usd")
      .eq("organization_id", orgId),
  ]);

  const agents = agentsRes.data ?? [];
  const totalAgents = agents.length;
  const runningAgents = agents.filter(
    (a) => a.status === "running" || a.status === "idle",
  ).length;
  const activelyRunning = agents.filter((a) => a.status === "running").length;

  const spendMonthUsd = (spendRes.data ?? []).reduce(
    (sum, row) => sum + Number(row.spent_monthly_usd ?? 0),
    0,
  );

  return NextResponse.json({
    activeAgents: runningAgents,
    totalAgents,
    activelyRunning,
    openIssues: failedRunsRes.count ?? 0,
    pendingApprovals: approvalsRes.count ?? 0,
    spendMonthUsd,
  });
}

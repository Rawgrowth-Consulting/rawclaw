import { NextResponse, type NextRequest } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { supabaseAdmin } from "@/lib/supabase/server";
import { DEFAULT_DEPARTMENTS } from "@/lib/agents/dto";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const orgId = await currentOrganizationId();
  const db = supabaseAdmin();

  // Optional department filter. Validated against the seeded slugs but
  // we also accept any custom slug that exists in rgaios_agents - the
  // /departments page allows custom slugs and we want stats to stay
  // consistent. Slug not present anywhere just yields zeroed counts,
  // which is fine for an empty dept page.
  const url = req.nextUrl;
  const rawDept = url.searchParams.get("department");
  const department =
    typeof rawDept === "string" && rawDept.length > 0 ? rawDept : null;

  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // When scoped to a department we resolve the agent ids first, then
  // use them as the filter for routine_runs (via routines.assignee) and
  // approvals (which already carry agent_id directly). Doing the join
  // in JS keeps the SQL portable across postgrest's eq/in surface
  // without inventing custom rpcs for the dept slice.
  let scopedAgentIds: string[] | null = null;
  let scopedRoutineIds: string[] | null = null;
  if (department) {
    const { data: deptAgents } = await db
      .from("rgaios_agents")
      .select("id")
      .eq("organization_id", orgId)
      .eq("department", department);
    scopedAgentIds = (deptAgents ?? []).map((r) => r.id as string);

    if (scopedAgentIds.length > 0) {
      const { data: deptRoutines } = await db
        .from("rgaios_routines")
        .select("id")
        .eq("organization_id", orgId)
        .in("assignee_agent_id", scopedAgentIds);
      scopedRoutineIds = (deptRoutines ?? []).map((r) => r.id as string);
    } else {
      scopedRoutineIds = [];
    }
  }

  // Build the four parallel queries. When scoping by department we
  // either constrain by routine ids (runs) or agent ids (approvals).
  // If the dept has zero agents we short-circuit to zero counts to
  // avoid sending an empty `.in()` (postgrest treats it as no filter).
  let agentsQuery = db
    .from("rgaios_agents")
    .select("id, status", { count: "exact" })
    .eq("organization_id", orgId);
  if (department) agentsQuery = agentsQuery.eq("department", department);

  const failedRunsPromise =
    department && scopedRoutineIds && scopedRoutineIds.length === 0
      ? Promise.resolve({ count: 0 })
      : (() => {
          let q = db
            .from("rgaios_routine_runs")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("status", "failed")
            .gte("created_at", sevenDaysAgo);
          if (department && scopedRoutineIds && scopedRoutineIds.length > 0) {
            q = q.in("routine_id", scopedRoutineIds);
          }
          return q;
        })();

  const completedRunsPromise =
    department && scopedRoutineIds && scopedRoutineIds.length === 0
      ? Promise.resolve({ count: 0 })
      : (() => {
          let q = db
            .from("rgaios_routine_runs")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("status", "succeeded")
            .gte("created_at", sevenDaysAgo);
          if (department && scopedRoutineIds && scopedRoutineIds.length > 0) {
            q = q.in("routine_id", scopedRoutineIds);
          }
          return q;
        })();

  const approvalsPromise =
    department && scopedAgentIds && scopedAgentIds.length === 0
      ? Promise.resolve({ count: 0 })
      : (() => {
          let q = db
            .from("rgaios_approvals")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("status", "pending");
          if (department && scopedAgentIds && scopedAgentIds.length > 0) {
            q = q.in("agent_id", scopedAgentIds);
          }
          return q;
        })();

  const [agentsRes, failedRunsRes, approvalsRes, completedRunsRes] =
    await Promise.all([
      agentsQuery,
      failedRunsPromise,
      approvalsPromise,
      completedRunsPromise,
    ]);

  const agents = ("data" in agentsRes ? agentsRes.data : null) ?? [];
  const totalAgents = agents.length;
  const runningAgents = agents.filter(
    (a) => a.status === "running" || a.status === "idle",
  ).length;
  const activelyRunning = agents.filter((a) => a.status === "running").length;

  return NextResponse.json({
    activeAgents: runningAgents,
    totalAgents,
    activelyRunning,
    openIssues: failedRunsRes.count ?? 0,
    pendingApprovals: approvalsRes.count ?? 0,
    runsThisWeek: completedRunsRes.count ?? 0,
    department: department ?? null,
    knownDepartment:
      department === null
        ? null
        : (DEFAULT_DEPARTMENTS as readonly string[]).includes(department),
  });
}

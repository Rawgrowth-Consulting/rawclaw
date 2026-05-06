import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { markRoutineRunNow } from "@/lib/routines/queries";
import { getOrgContext } from "@/lib/auth/admin";
import { isDepartmentAllowed } from "@/lib/auth/dept-acl";
import { dispatchRun } from "@/lib/runs/dispatch";
import { badUuidResponse } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/routines/[id]/run
 *
 * Enqueues a run for the routine and kicks off execution in the background
 * via `after()`. The HTTP response returns immediately with the new run id
 * so the UI can navigate to its status.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const bad = badUuidResponse(id);
    if (bad) return bad;
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId || !ctx.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const organizationId = ctx.activeOrgId;

    // ACL: marketing-only invitee can't fire a sales routine even if
    // they guess its id.
    const { data: routine } = await supabaseAdmin()
      .from("rgaios_routines")
      .select("assignee_agent_id, organization_id")
      .eq("id", id)
      .maybeSingle();
    if (!routine || routine.organization_id !== organizationId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (routine.assignee_agent_id) {
      const { data: agent } = await supabaseAdmin()
        .from("rgaios_agents")
        .select("department")
        .eq("id", routine.assignee_agent_id)
        .maybeSingle();
      const dept = (agent as { department: string | null } | null)?.department ?? null;
      const ok = await isDepartmentAllowed(
        {
          userId: ctx.userId,
          organizationId,
          isAdmin: ctx.isAdmin,
        },
        dept,
      );
      if (!ok) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const { data: run, error } = await supabaseAdmin()
      .from("rgaios_routine_runs")
      .insert({
        organization_id: organizationId,
        routine_id: id,
        source: "manual",
        status: "pending",
        input_payload: {},
      })
      .select("*")
      .single();
    if (error || !run) throw new Error(error?.message ?? "insert failed");

    await markRoutineRunNow(organizationId, id);

    dispatchRun(run.id, organizationId);

    return NextResponse.json(
      { ok: true, run_id: run.id },
      { status: 202 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

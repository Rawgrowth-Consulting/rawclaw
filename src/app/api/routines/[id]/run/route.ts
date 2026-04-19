import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { markRoutineRunNow } from "@/lib/routines/queries";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { dispatchRun } from "@/lib/runs/dispatch";

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
    const organizationId = await currentOrganizationId();

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

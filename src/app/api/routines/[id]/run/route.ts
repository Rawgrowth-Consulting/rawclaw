import { NextResponse, type NextRequest } from "next/server";
import { markRoutineRunNow } from "@/lib/routines/queries";
import { currentOrganizationId } from "@/lib/supabase/constants";

export const runtime = "nodejs";

/**
 * POST /api/routines/[id]/run
 *
 * For MVP this just stamps last_run_at so the UI shows the routine as
 * having been triggered. The real execution engine (invoking agents
 * with MCP tools) comes in Phase 8.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await markRoutineRunNow(currentOrganizationId(), id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

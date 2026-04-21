import { NextResponse } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { listAssignments } from "@/lib/skills/queries";
import { SKILLS_CATALOG } from "@/lib/skills/catalog";

export const runtime = "nodejs";

/**
 * GET /api/skills
 *
 * Returns the full catalog + the current assignments map so the UI can
 * render skill cards with accurate counts + agent lists on first paint.
 */
export async function GET() {
  try {
    const orgId = await currentOrganizationId();
    const assignments = await listAssignments(orgId);
    return NextResponse.json({
      catalog: SKILLS_CATALOG,
      assignments, // [{ agent_id, skill_id, created_at }]
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { listAssignments } from "@/lib/skills/queries";
import { SKILLS_CATALOG } from "@/lib/skills/catalog";

export const runtime = "nodejs";

/**
 * GET /api/skills
 *
 * Returns the full catalog + the current assignments map so the UI can
 * render skill cards with accurate counts + agent lists on first paint.
 *
 * Returns 401 when there's no session so the SWR client can surface the
 * error and the proxy can redirect the user to signin (matches the
 * pattern used by /api/members and other org-scoped routes).
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const assignments = await listAssignments(ctx.activeOrgId);
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

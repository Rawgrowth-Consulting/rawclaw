import { NextResponse, type NextRequest } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { replaceSkillAssignments } from "@/lib/skills/queries";
import { getSkill } from "@/lib/skills/catalog";

export const runtime = "nodejs";

/**
 * PUT /api/skills/[id]/assignments
 * Body: { agentIds: string[] }
 *
 * Full-set replacement. Whatever agentIds you send become the authoritative
 * list for this skill. To unassign, send the list without that agent in it.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!getSkill(id)) {
      return NextResponse.json({ error: "Unknown skill" }, { status: 404 });
    }
    const body = (await req.json()) as { agentIds?: unknown };
    if (!Array.isArray(body.agentIds)) {
      return NextResponse.json(
        { error: "agentIds array required" },
        { status: 400 },
      );
    }
    const agentIds = body.agentIds.filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );

    const orgId = await currentOrganizationId();
    await replaceSkillAssignments(orgId, id, agentIds);
    return NextResponse.json({ ok: true, count: agentIds.length });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

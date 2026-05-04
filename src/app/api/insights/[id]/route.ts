import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * PATCH /api/insights/[id] body { status: "acknowledged" | "dismissed" }
 *   acknowledged: greys out but stays visible
 *   dismissed:    hidden from list, won't regenerate for 24h
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { status?: string };
  const status = body.status;
  if (status !== "acknowledged" && status !== "dismissed") {
    return NextResponse.json(
      { error: "status must be acknowledged or dismissed" },
      { status: 400 },
    );
  }
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { status };
  if (status === "acknowledged") update.acknowledged_at = now;
  if (status === "dismissed") update.dismissed_at = now;
  const { error } = await supabaseAdmin()
    .from("rgaios_insights")
    .update(update as never)
    .eq("organization_id", ctx.activeOrgId)
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

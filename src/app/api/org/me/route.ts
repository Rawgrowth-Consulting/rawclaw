import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/org/me
 *
 * Returns the active organization's MCP config for the signed-in user.
 * Any authenticated user can read this for their own org; admins see it
 * scoped to whichever org they're currently viewing (via impersonation).
 *
 * Does NOT leak any other org's data.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: org, error } = await supabaseAdmin()
    .from("rgaios_organizations")
    .select("id, name, slug, mcp_token, created_at, marketing, sales, fulfilment, finance")
    .eq("id", ctx.activeOrgId)
    .maybeSingle();
  if (error || !org) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    org,
    pillars: {
      marketing: org.marketing ?? false,
      sales: org.sales ?? false,
      fulfilment: org.fulfilment ?? false,
      finance: org.finance ?? false,
    },
    isAdmin: ctx.isAdmin,
    isImpersonating: ctx.isImpersonating,
  });
}

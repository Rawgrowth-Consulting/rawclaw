import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";

export const runtime = "nodejs";

/**
 * GET /api/brand
 * Returns the latest approved brand profile for the active org.
 */
export async function GET() {
  try {
    const orgId = await currentOrganizationId();
    const { data } = await supabaseAdmin()
      .from("rgaios_brand_profiles")
      .select("id, version, content, status, generated_at, approved_at")
      .eq("organization_id", orgId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    return NextResponse.json({ profile: data ?? null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * PUT /api/brand
 * Body: { content: string }
 * Inserts a NEW version (version + 1) of the brand profile pre-approved.
 * Keeps history; old versions stay readable for diff/audit.
 */
export async function PUT(req: NextRequest) {
  try {
    const orgId = await currentOrganizationId();
    const body = (await req.json()) as { content?: string };
    const content = (body.content ?? "").trim();
    if (!content) {
      return NextResponse.json({ error: "content required" }, { status: 400 });
    }
    if (content.length > 100_000) {
      return NextResponse.json(
        { error: "content too large (max 100kb)" },
        { status: 400 },
      );
    }

    const { data: latest } = await supabaseAdmin()
      .from("rgaios_brand_profiles")
      .select("version")
      .eq("organization_id", orgId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = ((latest as { version?: number } | null)?.version ?? 0) + 1;
    const now = Date.now();

    const { data: inserted, error } = await supabaseAdmin()
      .from("rgaios_brand_profiles")
      .insert({
        organization_id: orgId,
        version: nextVersion,
        content,
        status: "approved",
        generated_at: now,
        approved_at: now,
        approved_by: "manual-edit",
      })
      .select("id, version")
      .single();
    if (error) throw error;
    return NextResponse.json({ profile: inserted });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

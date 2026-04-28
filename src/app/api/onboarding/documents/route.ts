import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function GET() {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = { id: ctx.activeOrgId, userId: ctx.userId };

    const { data: documents } = await supabaseAdmin()
      .from("rgaios_onboarding_documents")
      .select("*")
      .eq("organization_id", user.id);

    return NextResponse.json({ documents: documents || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = { id: ctx.activeOrgId, userId: ctx.userId };

    const { type, storage_url, filename, size } = await req.json();

    const { data: doc, error } = await supabaseAdmin()
      .from("rgaios_onboarding_documents")
      .insert({
        organization_id: user.id,
        type,
        storage_url,
        filename,
        size,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ document: doc });
  } catch (err: unknown) {
    console.error("Document save error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

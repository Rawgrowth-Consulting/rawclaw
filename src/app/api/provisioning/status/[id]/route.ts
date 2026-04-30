import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/provisioning/status/[id]
 *
 * Returns the public status of one rgaios_provisioning_queue row.
 * Used by the /portal/[id] page to poll until status='ready'. The id
 * IS the share-link secret  -  whoever has it can read the row, but
 * we don't return owner_email or temp_password, just the customer-safe
 * status fields.
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id || !/^[0-9a-f-]{32,40}$/i.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from("rgaios_provisioning_queue")
    .select("status, dashboard_url, error, plan_name, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: data.status,
    dashboard_url: data.dashboard_url,
    error: data.error,
    plan_name: data.plan_name,
    created_at: data.created_at,
    updated_at: data.updated_at,
  });
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/portal/[id]/status
 *
 * Customer-facing alias for /api/provisioning/status/[id]. Same payload,
 * cleaner URL semantics for the buyer-facing /portal/[id] page so the
 * polling URL lives under the same /portal namespace as the page itself.
 *
 * Public route. The id IS the share-link secret - whoever has the queue
 * row id sees the row. We never return owner_email, owner_name, or the
 * temp_password stashed in metadata - only customer-safe status fields.
 *
 * Why two routes pointing at the same row: the original
 * /api/provisioning/status path was wired into the admin tooling first
 * (admin/provisioning/Client.tsx), and renaming it would break that.
 * Adding the /api/portal/[id]/status alias keeps the buyer flow clean
 * without touching the admin call site.
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  // Same id-shape gate as the page so we don't even hit the DB on
  // bogus paths from crawlers.
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

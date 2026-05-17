import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/admin/telemetry
 *
 * Polled by the admin /telemetry view to pull recent
 * composeChatPreamble decisions (last 100 by default, optionally
 * filtered by ?agent=<uuid>). Returns the same shape the page
 * server-renders first paint with, so the client can swap on the
 * SWR result without re-mapping.
 */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const url = new URL(req.url);
  const agentFilter = url.searchParams.get("agent");
  const limit = Math.min(
    Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100,
    500,
  );

  let q = supabaseAdmin()
    .from("rgaios_chat_telemetry" as never)
    .select(
      "id, agent_id, mode, selected_block_ids, skipped_block_ids, estimated_tokens, budget_tokens, skipped_by_budget, message_count, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (agentFilter) {
    q = q.eq("agent_id", agentFilter);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: data ?? [] });
}

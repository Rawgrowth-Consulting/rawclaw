import { NextResponse, type NextRequest } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/agent-files?agentId=<uuid>
 *
 * Lists per-agent file metadata for the active org. Used by:
 *   - The agent panel Files tab (plan §5 sandboxed memory).
 *   - Smoke / vision audits to verify hire-flow auto-ingest actually
 *     landed starter MDs from src/lib/agents/starter-content/.
 *
 * agentId is required. Cross-tenant guard: only files where the parent
 * agent belongs to ctx.activeOrgId are returned.
 */
export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: agent } = await db
    .from("rgaios_agents")
    .select("id")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const { data, error } = await db
    .from("rgaios_agent_files")
    .select("id, filename, mime_type, size_bytes, storage_path, uploaded_by, uploaded_at")
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .order("uploaded_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ files: data ?? [] });
}

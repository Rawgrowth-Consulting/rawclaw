import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { fetchAgentHeatmap } from "@/lib/agent/heatmap";

export const runtime = "nodejs";

/**
 * GET /api/admin/heatmap?tz=<IANA>
 *
 * Returns the 7-day x 24-hour activity grid per agent for the
 * caller's active org. Default tz = UTC if no query param.
 */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin || !ctx.activeOrgId) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  const tz = new URL(req.url).searchParams.get("tz") ?? "UTC";
  const payload = await fetchAgentHeatmap(ctx.activeOrgId, tz);
  return NextResponse.json(payload);
}

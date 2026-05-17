import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { fetchAgentHeatmap, parseWindowDays } from "@/lib/agent/heatmap";

export const runtime = "nodejs";

/**
 * GET /api/admin/heatmap?tz=<IANA>&days=<7|30|90>
 *
 * Returns the 7-day x 24-hour activity grid per agent for the
 * caller's active org. days defaults to 7. tz defaults to UTC.
 */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin || !ctx.activeOrgId) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  const params = new URL(req.url).searchParams;
  const tz = params.get("tz") ?? "UTC";
  const windowDays = parseWindowDays(params.get("days"));
  const payload = await fetchAgentHeatmap(ctx.activeOrgId, tz, windowDays);
  return NextResponse.json(payload);
}

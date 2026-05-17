import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { isUuid } from "@/lib/utils";
import { fetchRecentChatTelemetry } from "@/lib/agent/telemetry";

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
  if (agentFilter && !isUuid(agentFilter)) {
    return NextResponse.json(
      { error: "agent must be a uuid" },
      { status: 400 },
    );
  }
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 100;

  const { rows, error } = await fetchRecentChatTelemetry({
    limit,
    agentId: agentFilter,
  });
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  return NextResponse.json({ rows });
}

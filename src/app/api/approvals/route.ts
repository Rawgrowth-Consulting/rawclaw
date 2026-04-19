import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { listApprovals } from "@/lib/approvals/queries";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") ?? "pending";
  const allowed = ["pending", "approved", "rejected", "all"] as const;
  const status = (allowed as readonly string[]).includes(statusParam)
    ? (statusParam as (typeof allowed)[number])
    : "pending";

  try {
    const approvals = await listApprovals(ctx.activeOrgId, status);
    return NextResponse.json({ approvals });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

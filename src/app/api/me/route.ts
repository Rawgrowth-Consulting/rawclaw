import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { getAllowedDepartments } from "@/lib/auth/dept-acl";

export const runtime = "nodejs";

/**
 * GET /api/me
 * Returns the session's per-org context flags the client needs to make
 * UI decisions (hide depts the user can't access, show admin chrome).
 * Stays small + cacheable so the sidebar can fetch it once per render.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const allowedDepartments = await getAllowedDepartments({
    userId: ctx.userId,
    organizationId: ctx.activeOrgId,
    isAdmin: ctx.isAdmin,
  });

  return NextResponse.json({
    ok: true,
    isAdmin: ctx.isAdmin,
    isImpersonating: ctx.isImpersonating,
    activeOrgId: ctx.activeOrgId,
    activeOrgName: ctx.activeOrgName,
    // null = no restriction (admin OR no allowed_departments set).
    // string[] = restricted to these slugs.
    allowedDepartments,
  });
}

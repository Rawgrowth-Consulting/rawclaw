import { NextResponse, type NextRequest } from "next/server";
import { getOrgBySlug, listEventTypes } from "@/lib/booking/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, ctx: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await ctx.params;
    const org = await getOrgBySlug(orgSlug);
    if (!org) return NextResponse.json({ error: "org_not_found" }, { status: 404 });
    const eventTypes = (await listEventTypes(org.id)).filter((e) => e.active);
    return NextResponse.json({
      org: { name: org.name, slug: org.slug },
      eventTypes: eventTypes.map((e) => ({
        slug: e.slug,
        title: e.title,
        description: e.description,
        durationMinutes: e.durationMinutes,
        color: e.color,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { getOrgBySlug } from "@/lib/booking/queries";
import { getPublicSlots } from "@/lib/booking/slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _: NextRequest,
  ctx: { params: Promise<{ orgSlug: string; eventSlug: string }> },
) {
  try {
    const { orgSlug, eventSlug } = await ctx.params;
    const org = await getOrgBySlug(orgSlug);
    if (!org) return NextResponse.json({ error: "org_not_found" }, { status: 404 });
    const result = await getPublicSlots({ orgId: org.id, slug: eventSlug });
    if (!result) return NextResponse.json({ error: "event_type_not_found" }, { status: 404 });
    return NextResponse.json({
      org: { name: org.name, slug: org.slug },
      title: result.title,
      timezone: result.timezone,
      durationMinutes: result.durationMinutes,
      slots: result.slots.map((s) => ({
        startUtc: s.startUtc.toISOString(),
        endUtc: s.endUtc.toISOString(),
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

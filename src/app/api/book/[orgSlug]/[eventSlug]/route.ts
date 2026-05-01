import { NextResponse, type NextRequest } from "next/server";
import { BookingError, createBookingForOrg } from "@/lib/booking/booking";
import { bookingRequestSchema } from "@/lib/booking/validation";
import { getOrgBySlug } from "@/lib/booking/queries";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orgSlug: string; eventSlug: string }> },
) {
  try {
    const { orgSlug, eventSlug } = await ctx.params;
    const org = await getOrgBySlug(orgSlug);
    if (!org) return NextResponse.json({ error: "org_not_found" }, { status: 404 });

    const body = await req.json();
    const parsed = bookingRequestSchema.safeParse({
      ...body,
      slug: eventSlug,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
    const booking = await createBookingForOrg({
      orgId: org.id,
      slug: parsed.data.slug,
      startUtc: new Date(parsed.data.startUtc),
      guestName: parsed.data.guestName,
      guestEmail: parsed.data.guestEmail,
      guestTimezone: parsed.data.guestTimezone,
      customAnswers: parsed.data.customAnswers,
      appUrl,
    });
    return NextResponse.json({
      booking: {
        manageToken: booking.manageToken,
        startUtc: booking.startUtc.toISOString(),
        endUtc: booking.endUtc.toISOString(),
        meetLink: booking.meetLink,
        status: booking.status,
      },
    });
  } catch (err) {
    if (err instanceof BookingError) {
      const status = err.code === "not_found" ? 404 : err.code === "slot_taken" ? 409 : 400;
      return NextResponse.json({ error: err.code, message: err.message }, { status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

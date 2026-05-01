import { NextResponse, type NextRequest } from "next/server";
import {
  BookingError,
  cancelBookingByToken,
  rescheduleBookingByToken,
} from "@/lib/booking/booking";
import { getBookingByToken } from "@/lib/booking/queries";
import { isValidTokenShape } from "@/lib/booking/tokens";

export const runtime = "nodejs";

export async function GET(_: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!isValidTokenShape(token)) {
      return NextResponse.json({ error: "invalid_token" }, { status: 400 });
    }
    const booking = await getBookingByToken(token);
    if (!booking) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({
      booking: {
        manageToken: booking.manageToken,
        eventTypeSlug: booking.eventTypeSlug,
        guestName: booking.guestName,
        guestEmail: booking.guestEmail,
        startUtc: booking.startUtc.toISOString(),
        endUtc: booking.endUtc.toISOString(),
        meetLink: booking.meetLink,
        status: booking.status,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!isValidTokenShape(token)) {
      return NextResponse.json({ error: "invalid_token" }, { status: 400 });
    }
    const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
    const booking = await cancelBookingByToken(token, appUrl);
    return NextResponse.json({ booking: { status: booking.status } });
  } catch (err) {
    if (err instanceof BookingError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!isValidTokenShape(token)) {
      return NextResponse.json({ error: "invalid_token" }, { status: 400 });
    }
    const body = await req.json();
    const newStartUtc = body?.startUtc;
    if (typeof newStartUtc !== "string") {
      return NextResponse.json({ error: "startUtc_required" }, { status: 400 });
    }
    const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
    const newBooking = await rescheduleBookingByToken(token, new Date(newStartUtc), appUrl);
    return NextResponse.json({
      booking: {
        manageToken: newBooking.manageToken,
        startUtc: newBooking.startUtc.toISOString(),
        endUtc: newBooking.endUtc.toISOString(),
        status: newBooking.status,
      },
    });
  } catch (err) {
    if (err instanceof BookingError) {
      const status = err.code === "slot_taken" ? 409 : 400;
      return NextResponse.json({ error: err.code, message: err.message }, { status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

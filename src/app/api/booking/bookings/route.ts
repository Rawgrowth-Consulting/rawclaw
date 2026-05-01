import { NextResponse } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { listBookings } from "@/lib/booking/queries";

export const runtime = "nodejs";

export async function GET() {
  try {
    const orgId = await currentOrganizationId();
    const bookings = await listBookings(orgId, { limit: 200 });
    return NextResponse.json({ bookings });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

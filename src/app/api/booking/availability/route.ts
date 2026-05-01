import { NextResponse, type NextRequest } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { getAvailability, updateAvailability } from "@/lib/booking/queries";
import { availabilityFormSchema } from "@/lib/booking/validation";

export const runtime = "nodejs";

export async function GET() {
  try {
    const orgId = await currentOrganizationId();
    const availability = await getAvailability(orgId);
    return NextResponse.json({ availability });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const orgId = await currentOrganizationId();
    const body = await req.json();
    const parsed = availabilityFormSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }
    const availability = await updateAvailability(orgId, {
      timezone: parsed.data.timezone,
      weeklyHours: parsed.data.weeklyHours.map((w) => ({
        dayOfWeek: w.dayOfWeek as 0 | 1 | 2 | 3 | 4 | 5 | 6,
        intervals: w.intervals,
      })),
      dateOverrides: parsed.data.dateOverrides,
    });
    return NextResponse.json({ availability });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

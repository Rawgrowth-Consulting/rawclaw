import { NextResponse, type NextRequest } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { listCalendars } from "@/lib/booking/calendar";
import { getCalendarBinding, setCalendarBinding } from "@/lib/booking/queries";
import { calendarBindingFormSchema } from "@/lib/booking/validation";

export const runtime = "nodejs";

export async function GET() {
  try {
    const orgId = await currentOrganizationId();
    const binding = await getCalendarBinding(orgId);
    let calendars: Array<{ id: string; summary: string; primary: boolean }> = [];
    try {
      calendars = await listCalendars(orgId);
    } catch (err) {
      return NextResponse.json({ binding, calendars: [], listError: (err as Error).message });
    }
    return NextResponse.json({ binding, calendars });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const orgId = await currentOrganizationId();
    const body = await req.json();
    const parsed = calendarBindingFormSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }
    const binding = await setCalendarBinding(orgId, parsed.data);
    return NextResponse.json({ binding });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

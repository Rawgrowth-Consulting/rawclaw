import { NextResponse, type NextRequest } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { listEventTypes, upsertEventType } from "@/lib/booking/queries";
import { eventTypeFormSchema } from "@/lib/booking/validation";

export const runtime = "nodejs";

export async function GET() {
  try {
    const orgId = await currentOrganizationId();
    const eventTypes = await listEventTypes(orgId);
    return NextResponse.json({ eventTypes });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = await currentOrganizationId();
    const body = await req.json();
    const parsed = eventTypeFormSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }
    const evt = await upsertEventType(orgId, parsed.data);
    return NextResponse.json({ eventType: evt });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import {
  deleteEventType,
  getEventTypeById,
  upsertEventType,
} from "@/lib/booking/queries";
import { eventTypeFormSchema } from "@/lib/booking/validation";

export const runtime = "nodejs";

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const orgId = await currentOrganizationId();
    const evt = await getEventTypeById(orgId, id);
    if (!evt) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ eventType: evt });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const orgId = await currentOrganizationId();
    const body = await req.json();
    const parsed = eventTypeFormSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }
    const evt = await upsertEventType(orgId, { ...parsed.data, id });
    return NextResponse.json({ eventType: evt });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const orgId = await currentOrganizationId();
    await deleteEventType(orgId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

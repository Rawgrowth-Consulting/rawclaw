import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { nango } from "@/lib/nango/server";
import { upsertConnection } from "@/lib/connections/queries";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/connections/finalize
 * Body: { providerConfigKey: string, connectionId: string }
 *
 * Called by the client after the Nango Connect UI completes. Verifies the
 * connection exists in Nango (prevents clients from fabricating rows) and
 * upserts it into rgaios_connections for the caller's org. This is the
 * primary persistence path in dev and a safety net in prod; the webhook
 * handler also writes on auth events when reachable.
 */
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    providerConfigKey?: string;
    connectionId?: string;
  };
  const { providerConfigKey, connectionId } = body;
  if (!providerConfigKey || !connectionId) {
    return NextResponse.json(
      { error: "providerConfigKey and connectionId are required" },
      { status: 400 },
    );
  }

  try {
    // Verify the connection exists in Nango and belongs to this org.
    const conn = await nango().getConnection(providerConfigKey, connectionId);

    const endUserId = (conn as { end_user?: { id?: string } }).end_user?.id;
    if (endUserId && endUserId !== ctx.activeOrgId) {
      return NextResponse.json(
        { error: "Connection end_user does not match active organization" },
        { status: 403 },
      );
    }

    const displayName =
      (conn.credentials as { email?: string } | undefined)?.email ??
      (conn.connection_config as { login?: string } | undefined)?.login ??
      (conn.connection_config as { email?: string } | undefined)?.email ??
      null;

    const row = await upsertConnection({
      organizationId: ctx.activeOrgId,
      providerConfigKey,
      nangoConnectionId: connectionId,
      displayName,
    });

    await supabaseAdmin().from("rgaios_audit_log").insert({
      organization_id: ctx.activeOrgId,
      kind: "connection_connected",
      actor_type: "user",
      actor_id: ctx.userId,
      detail: { providerConfigKey, source: "client_finalize", displayName },
    });

    return NextResponse.json({ connection: row });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

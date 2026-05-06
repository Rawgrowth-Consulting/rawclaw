import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { tryDecryptSecret } from "@/lib/crypto";
import { requireCronAuth } from "@/lib/cron/auth";

export const runtime = "nodejs";

/**
 * GET /api/cron/claude-token
 *
 * Returns the org's currently-stored Claude Max long-lived token so the
 * VPS-side tick script can sync it into `/home/rawclaw/.claude/.credentials.json`.
 *
 * Self-hosted is single-tenant per VPS, so we just return whatever connection
 * row exists for `provider_config_key = 'claude-max'` regardless of org id.
 *
 * Auth: same `Bearer ${CRON_SECRET}` convention as `/api/cron/schedule-tick`.
 * The route is in the `/api/cron` PUBLIC_API_PREFIXES exemption (no session
 * cookie required), but still validates the bearer here.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const { data, error } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("metadata, organization_id, connected_at")
    .eq("provider_config_key", "claude-max")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ connected: false, token: null });
  }
  const meta = (data.metadata ?? {}) as {
    access_token?: string;
    installed_at?: string;
  };
  const token = tryDecryptSecret(meta.access_token);
  if (!token) {
    return NextResponse.json({ connected: false, token: null });
  }
  return NextResponse.json({
    connected: true,
    token,
    installed_at: meta.installed_at ?? data.connected_at,
    organization_id: data.organization_id,
  });
}

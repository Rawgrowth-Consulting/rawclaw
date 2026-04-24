import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getConnection, upsertConnection } from "@/lib/connections/queries";
import {
  encryptSecret,
  tryDecryptSecret,
} from "@/lib/crypto";
import {
  exchangeCodeForToken,
  unpackState,
} from "@/lib/agent/slack-oauth";

export const runtime = "nodejs";

const PROVIDER_KEY = "slack";

/**
 * GET /api/connections/slack/oauth/callback?code=...&state=...
 *
 * Slack redirects the user's browser here after they authorize the
 * install. We exchange the code for a bot token (server-side, from the
 * VPS), store everything encrypted in rgaios_connections, then bounce
 * the user back to /connections with a `slack=connected` query so the
 * UI can show a success toast.
 *
 * If Slack returned an error (user clicked Cancel, mismatched scopes,
 * etc.) we bounce them back with `slack=error&reason=...`.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const slackError = url.searchParams.get("error");

  const origin = (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    url.origin
  ).replace(/\/$/, "");

  function bounce(qs: string) {
    return NextResponse.redirect(`${origin}/connections?${qs}`);
  }

  if (slackError) {
    return bounce(`slack=error&reason=${encodeURIComponent(slackError)}`);
  }
  if (!code || !state) {
    return bounce("slack=error&reason=missing_params");
  }

  const unpacked = unpackState(state);
  if (!unpacked) {
    return bounce("slack=error&reason=invalid_state");
  }

  const conn = await getConnection(unpacked.organizationId, PROVIDER_KEY);
  const meta = (conn?.metadata ?? {}) as {
    client_id?: string;
    client_secret?: string;
  };
  if (!meta.client_id || !meta.client_secret) {
    return bounce("slack=error&reason=app_config_missing");
  }
  const clientSecret = tryDecryptSecret(meta.client_secret);
  if (!clientSecret) {
    return bounce("slack=error&reason=app_config_corrupt");
  }

  const redirectUri = `${origin}/api/connections/slack/oauth/callback`;
  const exchange = await exchangeCodeForToken({
    clientId: meta.client_id,
    clientSecret,
    code,
    redirectUri,
  });
  if (!exchange.ok) {
    return bounce(
      `slack=error&reason=${encodeURIComponent(`exchange_failed:${exchange.error}`)}`,
    );
  }

  const installedAt = new Date().toISOString();
  await upsertConnection({
    organizationId: unpacked.organizationId,
    providerConfigKey: PROVIDER_KEY,
    nangoConnectionId: `slack-ws:${exchange.team_id}`,
    displayName: exchange.team_name,
    metadata: {
      ...meta,
      bot_token: encryptSecret(exchange.access_token),
      bot_user_id: exchange.bot_user_id,
      team_id: exchange.team_id,
      team_name: exchange.team_name,
      scope: exchange.scope,
      installed_at: installedAt,
    },
  });

  await supabaseAdmin()
    .from("rgaios_audit_log")
    .insert({
      organization_id: unpacked.organizationId,
      kind: "connection_connected",
      actor_type: "user",
      actor_id: "session",
      detail: {
        provider: "slack",
        step: "workspace_installed",
        team: exchange.team_name,
      },
    });

  return bounce(
    `slack=connected&team=${encodeURIComponent(exchange.team_name)}`,
  );
}

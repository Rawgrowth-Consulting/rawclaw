import { registerTool, text, textError } from "../registry";
import { supabaseAdmin } from "@/lib/supabase/server";
import { CONNECTOR_CATALOG } from "@/lib/connections/catalog";
import { composioAppNameFor } from "@/lib/connections/catalog";

/**
 * Composio Connect MCP tool.
 *
 * BUG-32 (D 2026-05-18, R-COMPOSIO-3 calendar walk): when a user
 * asked Scan to create a Google Calendar event, Scan honest-failed
 * with "Google Calendar OAuth isn't connected on this workspace -
 * fix is a one-time connect: go to /connections and authorize" and
 * the operator was stuck navigating manually + the chain ended.
 *
 * Pedro feedback verbatim: "ent krl, tu é burro? a gente tem o
 * composio, tem a apify tool call, pq nn tem mcp porra?". Composio
 * platform IS plugged in at workspace level (api key set,
 * auth_configs cached) - only the per-toolkit grant per workspace
 * is missing for new toolkits (Gmail has a real connected_account
 * already - draft id r6643082403553940261 - Calendar does not).
 *
 * Fix: expose the same per-toolkit OAuth-link flow that the
 * /connections UI uses (src/app/api/connections/composio/route.ts:99
 * POST /api/v3/connected_accounts/link) as an MCP tool so the agent
 * can surface a clickable connect link inline in chat. User clicks,
 * authorizes Google, the existing OAuth callback
 * (/api/connections/composio/callback) flips the pending row to
 * connected, and the next tool call (composio_use_tool google_calendar
 * create_event) just works.
 *
 * Wire shape mirrors composio-router exactly: per-org Composio API
 * key resolution, auth_config cache via resolveOrCreateAuthConfig,
 * supabaseAdmin pending row insert keyed by provider_config_key.
 */

registerTool({
  name: "composio_connect_app",
  description:
    "Generate a Composio OAuth connect link for the user to authorize a toolkit (Google Calendar, Slack, Notion, etc.) directly from chat. Call this when a Composio tool call failed with 'no connected account' for some toolkit, or when the user explicitly asks to connect an app. Returns a one-click redirect URL the operator clicks to grant access; the OAuth callback wires the connection automatically and the next tool call to that toolkit will succeed. Pass `app` as the Composio toolkit slug (e.g. \"googlecalendar\", \"slack\", \"notion\") or its catalog display key (e.g. \"google-calendar\"); both resolve. If the app is already connected this still returns a fresh link so the user can re-grant (rare; explain that's optional).",
  inputSchema: {
    type: "object",
    properties: {
      app: {
        type: "string",
        description:
          "Composio toolkit slug (e.g. 'googlecalendar', 'gmail', 'slack') or display key (e.g. 'google-calendar'). Required.",
      },
    },
    required: ["app"],
  },
  isWrite: true,
  handler: async (args, ctx) => {
    const appRaw = typeof args.app === "string" ? args.app.trim() : "";
    if (!appRaw) {
      return textError(
        "composio_connect_app: missing required `app` (toolkit slug or display key).",
      );
    }

    // Resolve display key vs toolkit slug. CONNECTOR_CATALOG uses
    // display keys ("google-calendar"); Composio v3 uses canonical
    // slugs ("googlecalendar"). composioAppNameFor handles the map
    // and is a no-op for slugs already in canonical form.
    const toolkitSlug = composioAppNameFor(appRaw);
    const catalogEntry = CONNECTOR_CATALOG.find(
      (c) => c.key === appRaw || composioAppNameFor(c.key) === toolkitSlug,
    );
    const providerConfigKey = `composio:${catalogEntry?.key ?? appRaw}`;
    const displayName = catalogEntry?.name ?? toolkitSlug;

    const { resolveComposioApiKey, resolveOrCreateAuthConfig } = await import(
      "@/lib/composio/proxy"
    );
    const apiKey = await resolveComposioApiKey(ctx.organizationId);
    if (!apiKey) {
      return textError(
        "Composio API key missing for this workspace. Set it once in Connections → Workspace API keys (or COMPOSIO_API_KEY env on the VPS), then retry.",
      );
    }

    const authConfigId = await resolveOrCreateAuthConfig(
      ctx.organizationId,
      toolkitSlug,
      apiKey,
    );
    if (!authConfigId) {
      return textError(
        `Composio could not provision an auth_config for toolkit "${toolkitSlug}". Likely an unknown slug. Run composio_list_tools to confirm the slug Composio expects, then retry.`,
      );
    }

    const callbackBase = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/connections/composio/callback`;
    let redirectUrl: string | undefined;
    let connectedAccountId: string | undefined;
    try {
      const r = await fetch(
        "https://backend.composio.dev/api/v3/connected_accounts/link",
        {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            auth_config_id: authConfigId,
            // user_id scopes the Composio grant per workspace member -
            // mirrors /api/connections/composio POST so the OAuth
            // callback can match the pending row by (org, user, key).
            user_id: ctx.userId ?? ctx.organizationId,
            callback_url: callbackBase,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!r.ok) {
        const errText = (await r.text()).slice(0, 300);
        return textError(
          `Composio /connected_accounts/link failed: ${r.status} ${errText}`,
        );
      }
      const data = (await r.json()) as {
        redirect_url?: string;
        connected_account_id?: string;
      };
      redirectUrl = data.redirect_url;
      connectedAccountId = data.connected_account_id;
    } catch (err) {
      return textError(
        `Composio connect link request failed: ${(err as Error).message}`,
      );
    }
    if (!redirectUrl) {
      return textError(
        "Composio returned no redirect_url; cannot surface a connect link to the operator. Retry or wire manually at /connections.",
      );
    }

    // Persist pending row so the existing OAuth callback (route at
    // /api/connections/composio/callback) can upgrade it to 'connected'
    // when the user finishes the OAuth dance. Mirrors the pending row
    // shape from src/app/api/connections/composio/route.ts:182-204.
    const db = supabaseAdmin();
    const callerUserId = ctx.userId ?? null;
    const existing = callerUserId
      ? await db
          .from("rgaios_connections")
          .select("id")
          .eq("organization_id", ctx.organizationId)
          .eq("provider_config_key", providerConfigKey)
          .is("agent_id", null)
          .eq("user_id" as never, callerUserId)
          .maybeSingle()
      : await db
          .from("rgaios_connections")
          .select("id")
          .eq("organization_id", ctx.organizationId)
          .eq("provider_config_key", providerConfigKey)
          .is("agent_id", null)
          .is("user_id" as string, null)
          .maybeSingle();

    const pendingRow = {
      organization_id: ctx.organizationId,
      user_id: callerUserId,
      agent_id: null,
      provider_config_key: providerConfigKey,
      nango_connection_id:
        connectedAccountId ?? `pending-${Date.now()}`,
      display_name: displayName,
      status: "pending_token",
      metadata: {
        composio_app: catalogEntry?.key ?? appRaw,
        composio_auth_config_id: authConfigId,
        started_at: new Date().toISOString(),
        initiated_by: "composio_connect_app_mcp",
      },
    };
    try {
      if (existing.data) {
        await db
          .from("rgaios_connections")
          .update(pendingRow as never)
          .eq("id", existing.data.id);
      } else {
        await db
          .from("rgaios_connections")
          .insert(pendingRow as never);
      }
    } catch (err) {
      // Persisting failed but we still have a valid redirect_url - the
      // user can click it and the callback will create a fresh row.
      // Log and continue so the agent surface stays clickable.
      console.warn(
        `[composio_connect_app] pending row write failed (continuing): ${(err as Error).message}`,
      );
    }

    return text(
      `Connect link ready: open this URL to authorize ${displayName}.\n\n${redirectUrl}\n\nOnce you finish the OAuth grant the connection wires automatically and I can retry the original action without you doing anything else.`,
    );
  },
});

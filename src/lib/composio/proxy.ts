import { getConnection } from "@/lib/connections/queries";

/**
 * Composio proxy wrapper. Mirrors src/lib/mcp/proxy.ts (which fronts
 * Nango), but resolves connections via Composio's API instead.
 *
 * Composio swap gap #1: agents that want to call a Composio-backed app
 * (e.g. send a Slack message via the linkedin app) need an outbound
 * proxy that takes (orgId, appKey, action) and forwards to Composio's
 * `executeAction` endpoint with the right entityId + connectionId.
 *
 * Resolves the local rgaios_connections row (provider_config_key =
 * "composio:<appKey>"), pulls the stored connectionId, then invokes
 * `POST /api/v1/actions/{action}/execute` against Composio. API key
 * lives in COMPOSIO_API_KEY env.
 */

type ComposioProxyOpts = {
  /** App key as it appears in src/lib/connections/catalog.ts (e.g. "linkedin", "gmail"). */
  appKey: string;
  /** Composio action slug, e.g. "GMAIL_SEND_EMAIL". Composio's catalog. */
  action: string;
  /** Action input schema — passed verbatim to Composio. */
  input: Record<string, unknown>;
};

export async function composioCall<T = unknown>(
  organizationId: string,
  opts: ComposioProxyOpts,
): Promise<T> {
  const composioKey = process.env.COMPOSIO_API_KEY;
  if (!composioKey) {
    throw new Error(
      "COMPOSIO_API_KEY missing - composio integration not configured",
    );
  }
  const pck = `composio:${opts.appKey}`;
  const conn = await getConnection(organizationId, pck);
  if (!conn) {
    throw new Error(`${opts.appKey} isn't connected via Composio for this org`);
  }
  if (conn.status !== "connected") {
    throw new Error(
      `${opts.appKey} is in status='${conn.status}' - finish OAuth before calling`,
    );
  }
  const res = await fetch(
    `https://backend.composio.dev/api/v1/actions/${encodeURIComponent(opts.action)}/execute`,
    {
      method: "POST",
      headers: {
        "x-api-key": composioKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        connectedAccountId: conn.nango_connection_id,
        entityId: organizationId,
        input: opts.input,
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `composio ${opts.action} ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

/**
 * Thin wrapper over apify-client SDK. We call public actors (FB Ads
 * Library, IG profile, YT channel, etc.) on-demand from the scrape
 * worker. Token resolution order:
 *   1. per-org rgaios_connections row (provider_config_key='apify-key',
 *      metadata.api_key encrypted) - lets each client BYOK from the
 *      Connections page without redeploying.
 *   2. APIFY_API_TOKEN env var - shared fallback for self-hosted
 *      operators that don't want a per-client key.
 *
 * Plan refs: §8 (top-performing scrape) and §13 (best-ads scrape).
 */
import { ApifyClient } from "apify-client";
import { supabaseAdmin } from "@/lib/supabase/server";
import { tryDecryptSecret } from "@/lib/crypto";

const orgClientCache = new Map<string, ApifyClient | null>();

async function getOrgToken(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("metadata")
    .eq("organization_id", orgId)
    .eq("provider_config_key", "apify-key")
    .maybeSingle();
  const meta = (data?.metadata ?? {}) as { api_key?: string };
  return tryDecryptSecret(meta.api_key);
}

async function getClient(orgId?: string | null): Promise<ApifyClient | null> {
  if (orgId) {
    if (orgClientCache.has(orgId)) return orgClientCache.get(orgId) ?? null;
    const orgToken = await getOrgToken(orgId);
    if (orgToken) {
      const c = new ApifyClient({ token: orgToken });
      orgClientCache.set(orgId, c);
      return c;
    }
    orgClientCache.set(orgId, null);
  }
  const envToken = process.env.APIFY_API_TOKEN;
  return envToken ? new ApifyClient({ token: envToken }) : null;
}

export async function isApifyEnabled(orgId?: string | null): Promise<boolean> {
  if (orgId) {
    const t = await getOrgToken(orgId);
    if (t) return true;
  }
  return Boolean(process.env.APIFY_API_TOKEN);
}

export function clearApifyCache(orgId?: string): void {
  if (orgId) orgClientCache.delete(orgId);
  else orgClientCache.clear();
}

/**
 * Run an Apify actor synchronously and return the dataset items.
 * Returns null when no token is configured for the org (or env fallback)
 * so callers can fall back to the public-source fetcher path.
 */
export async function runActor<T = unknown>(
  actorId: string,
  input: Record<string, unknown>,
  orgId?: string | null,
): Promise<T[] | null> {
  const client = await getClient(orgId);
  if (!client) return null;
  const run = await client.actor(actorId).call(input);
  if (!run?.defaultDatasetId) return [];
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items as T[];
}

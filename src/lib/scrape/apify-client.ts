/**
 * Thin wrapper over apify-client SDK. We call public actors (FB Ads
 * Library, IG profile, YT channel, etc.) on-demand from the scrape
 * worker. Token lives in env  -  one workspace key shared across all
 * v3 VPSes since Apify charges per-run, not per-account.
 *
 * Plan refs: §8 (top-performing scrape) and §13 (best-ads scrape).
 *
 * Behavior:
 *   - Caller passes actor id ("apify/facebook-ads-scraper") + input.
 *   - We block until the run finishes, then return the dataset items.
 *   - Token missing  ->  return null (caller logs warn + skips).
 *   - Any actor error or timeout  ->  bubble up; caller decides.
 */
import { ApifyClient } from "apify-client";

let cached: ApifyClient | null | undefined;

function getClient(): ApifyClient | null {
  if (cached !== undefined) return cached;
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    cached = null;
    return null;
  }
  cached = new ApifyClient({ token });
  return cached;
}

export function isApifyEnabled(): boolean {
  return Boolean(process.env.APIFY_API_TOKEN);
}

/**
 * Run an Apify actor synchronously and return the dataset items.
 * Returns null when APIFY_API_TOKEN is unset so callers can fall back
 * to the public-source fetcher path.
 */
export async function runActor<T = unknown>(
  actorId: string,
  input: Record<string, unknown>,
): Promise<T[] | null> {
  const client = getClient();
  if (!client) return null;
  const run = await client.actor(actorId).call(input);
  if (!run?.defaultDatasetId) return [];
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items as T[];
}

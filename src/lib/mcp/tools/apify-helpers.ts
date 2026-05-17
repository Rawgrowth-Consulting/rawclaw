/**
 * Shared helpers extracted from src/lib/mcp/tools/apify.ts per
 * [C 02:40 SIMPLIFY apify.ts] report + [B 02:41 → C UNBLOCKED]
 * action mandate.
 *
 * apify.ts grew to 1900+ lines across 15+ scrape variants; each
 * variant inlined the same 5-line null-to-string coercion +
 * actor-path / posix-tilde rewrite + post-time field probe.
 * Replacing each inline def with one shared import removes the
 * fix-risk (a bug in one inline never lands in the other four)
 * and shrinks the file.
 *
 * Hot path lines 1236-1280 (A's H32 readAgentFileBody +
 * Levenshtein) NOT touched by this extract per [B 02:41]
 * ownership map.
 */

/**
 * Null-/undefined-safe string coercion used everywhere we have to
 * read string fields out of an Apify-scraped JSON record. typeof
 * "string" passes through; null/undefined yield empty string;
 * anything else stringifies via String().
 */
export function coerceToString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/**
 * Apify actor IDs in our config are stored as "owner/actor"
 * (e.g. "apify/instagram-scraper") but the REST API path uses
 * "owner~actor". Centralising the rewrite stops the slash-vs-tilde
 * detail from leaking into every call site.
 */
export function actorPathOf(actorId: string): string {
  return actorId.replace("/", "~");
}

/**
 * Apify's POST endpoints answer 200 OR 201 depending on whether
 * the run is sync or async. Several call sites checked only one
 * of those, so a sync actor that returned 201 was treated as
 * failure. Use this guard at every API boundary that posts to
 * the Apify run API.
 */
export function isApifyOk(status: number): boolean {
  return status === 200 || status === 201;
}

/**
 * Post-time field probe used to sort scraped items newest-first.
 * Apify actors expose the timestamp under 5+ different keys
 * across Instagram / Facebook / TikTok / web; this helper checks
 * them in priority order and returns ms since epoch (epoch
 * seconds get scaled). Returns 0 when no field is present so
 * sort still works (item lands at the start of "unknown" bucket).
 */
const POST_TIME_FIELDS = [
  "timestamp",
  "takenAt",
  "taken_at_timestamp",
  "takenAtTimestamp",
  "created_time",
  "createdAt",
  "publishedAt",
] as const;

export function parsePostTime(raw: unknown): number {
  const r = (raw ?? {}) as Record<string, unknown>;
  for (const k of POST_TIME_FIELDS) {
    const v = r[k];
    if (typeof v === "number") {
      return v > 1e12 ? v : v * 1000;
    }
    if (typeof v === "string") {
      const parsed = Date.parse(v);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

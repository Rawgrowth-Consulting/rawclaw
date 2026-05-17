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

/**
 * Comment-count field probe. Instagram exposes commentsCount,
 * Facebook commentCount, web feeds comments. Returns 0 when no
 * field is present so caller-side sort + display always works.
 */
const COMMENT_FIELDS = ["commentsCount", "commentCount", "comments"] as const;

export function commentCount(raw: unknown): number {
  const r = (raw ?? {}) as Record<string, unknown>;
  for (const k of COMMENT_FIELDS) {
    const v = r[k];
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

const MAX_API_ERROR_BODY_CHARS = 200;

/**
 * Format an Apify REST error into one operator-clean line. Used
 * by every fetch call site that bails on non-2xx. Centralises
 * the body-slice + status prefix so error rows in the audit log
 * stay consistent + a future humanizer pass can hit one spot.
 */
export function formatApiError(opts: {
  tool: string;
  status: number;
  bodyPreview?: string;
  context?: string;
}): string {
  const body = (opts.bodyPreview ?? "").slice(0, MAX_API_ERROR_BODY_CHARS);
  const ctx = opts.context ? ` (${opts.context})` : "";
  const tail = body ? `: ${body}` : "";
  return `apify ${opts.tool} HTTP ${opts.status}${ctx}${tail}`;
}

/**
 * Coerce an unknown arg into a string array. Apify tools accept
 * handle lists from the model as a JSON array; null / undefined
 * / non-array fall back to []. Stringifies each entry via
 * coerceToString so [null, "foo"] becomes ["", "foo"] - caller
 * filters empties with .filter(Boolean) when desired.
 */
export function parseStringArray(arg: unknown): string[] {
  if (!Array.isArray(arg)) return [];
  return arg.map((v) => coerceToString(v));
}

/**
 * Extract Instagram-style handle list from a free-text arg.
 * Requires either an "@" prefix or an "instagram.com/" URL
 * prefix - bare words are too ambiguous to grep out of arbitrary
 * operator copy without false positives (the "https"/"and" tokens
 * would otherwise sneak in). Strips trailing slash so each handle
 * is exactly the username Apify expects. De-dups + drops empties.
 */
const HANDLE_RE = /(?:instagram\.com\/|@)([A-Za-z0-9._]{1,30})/g;

export function extractHandles(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of raw.matchAll(HANDLE_RE)) {
    const h = (m[1] ?? "").replace(/[/.]+$/, "");
    if (!h || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

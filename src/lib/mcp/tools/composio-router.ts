import { registerTool, text, textError } from "../registry";
import { shouldGateTool } from "../approval-gate";
import { composioAction } from "../proxy";
import { createApproval } from "@/lib/approvals/queries";
import { supabaseAdmin } from "@/lib/supabase/server";
import { composioAppNameFor } from "@/lib/connections/catalog";

/**
 * Composio Tool Router MCP surface.
 *
 * Composio's Tool Router (Sept 2025) exposes 1000+ apps through a
 * single MCP endpoint with per-user session scoping. Instead of writing
 * one tool per app+action and shipping a redeploy every time a client
 * wires a new integration, we register two tools here and let the
 * model pick what to call:
 *
 *   - composio_list_tools({ app? })   - discover available actions
 *                                       (whole catalog or filtered to
 *                                       one app the client connected).
 *   - composio_use_tool({ app, action, input }) - invoke any of those
 *                                       actions through Composio with
 *                                       the caller's per-user OAuth
 *                                       grant from migration 0063.
 *
 * Both tools route through composioAction so per-user OAuth
 * (Worker 1 / PR 1 thread) carries through automatically: ctx.userId
 * is forwarded as the 5th arg, getConnection prefers the per-user row,
 * and Composio's executeAction sees the matching entityId. Without
 * that thread the router would silently borrow the first user's
 * grant for every member of the org - same bug Claude Max already
 * hit and we already fixed.
 */

type ComposioActionListItem = {
  name?: string;
  enum?: string;
  /** v3 returns slug instead of enum. Discovery accepts either. */
  slug?: string;
  display_name?: string;
  appName?: string;
  appKey?: string;
  description?: string;
  /** v3 nests toolkit metadata. */
  toolkit?: { slug?: string; name?: string };
};

type ComposioActionListResponse = {
  items?: ComposioActionListItem[];
  // Older shapes seen in Composio responses - tolerate both.
  actions?: ComposioActionListItem[];
  // v3 cursor pagination. Tolerate snake_case + camelCase + nested.
  next_cursor?: string | null;
  nextCursor?: string | null;
  pagination?: { next_cursor?: string | null; nextCursor?: string | null };
};

// ─── Pagination caps for composio_list_tools ────────────────────────
//
// Composio v3 /api/v3/tools defaults to ~20 items per page. Without
// loop+cursor we silently drop the long tail (W6 found this:
// SLACK_SEND_MESSAGE was missing because alphabetical ordering put
// SLACK_ADD_*, SLACK_ARCHIVE_* in the first page). Loop until cursor
// drains, capped at PAGE_LIMIT*MAX_PAGES so a runaway upstream can't
// blow heap. limit=200 matches Composio's documented per-page max.
const COMPOSIO_PAGE_LIMIT = 200;
const COMPOSIO_MAX_PAGES = 3; // 3 * 200 = 600 raw, sliced to 500 below
const COMPOSIO_TOTAL_CAP = 500;

// ─── 5-min cache for composio_list_tools ────────────────────────────
//
// Discovery is read-only and the catalog only changes when Composio
// adds an action upstream. Without a cache every model turn fetches
// + serializes ~200 actions (~15k tokens) and burns Composio rate
// limit headroom. Cache keyed on (orgId, app filter) so per-org
// scoping (when Composio adds it) still works; today it's effectively
// a global cache.
type ListCacheEntry = { actions: ComposioActionListItem[]; until: number };
const LIST_CACHE_TTL_MS = 300_000;
const composioListCache = new Map<string, ListCacheEntry>();

// ─── Connection-scoping for composio_list_tools ─────────────────────
//
// Why: composio_list_tools used to call GET /api/v3/tools with ONLY the
// x-api-key header. composio_use_tool's working path (composioCall ->
// listComposioTokensForUser) always resolves the org's rgaios_connections
// rows first, so Composio sees which toolkits the org actually wired and
// the call succeeds. The discovery call had no equivalent scoping, so for
// some orgs Composio answered the unscoped /api/v3/tools request with an
// "isn't connected ... for this org" error body - even though Gmail was
// genuinely connected and composio_use_tool worked fine. The divergence
// was: use_tool resolves the connection, list_tools did not.
//
// Composio v3's /api/v3/tools accepts an `auth_config_ids` query param
// to scope the listing to specific connected auth configs. We resolve
// the org's connected auth_config_ids from the same rgaios_connections
// table the working path reads, then pass them through. This mirrors
// composio_use_tool's connection resolution for the discovery surface.
//
// The connect flow (src/app/api/connections/composio/route.ts) stores
// the auth_config_id in two places per connected toolkit:
//   - a synthetic row `provider_config_key='composio-auth-config:<slug>'`
//     with the id in `nango_connection_id` (resolveOrCreateAuthConfig).
//   - the connected-account row's `metadata.composio_auth_config_id`.
// We read both so a connection wired before either path existed still
// resolves. Returns [] when the org has no Composio connections at all
// (e.g. catalog-only browse) so the caller falls back to the unscoped
// global catalog call - that keeps pure discovery working.
async function resolveComposioAuthConfigIds(
  organizationId: string,
  /**
   * Optional app/toolkit slug to scope the returned auth_config_ids
   * to. When set, only `composio:<appFilter>` connection rows and
   * `composio-auth-config:<appFilter>` synthetic cache rows match -
   * which is the load-bearing scoping for `composio_list_tools` so
   * Composio v3's `/api/v3/tools?toolkit_slug=...&auth_config_ids=...`
   * doesn't return tools from OTHER connected apps when the org has
   * gmail + google-calendar + slack all wired (A 00:41 root-cause:
   * unscoped auth_config_ids list let Composio answer with gmail
   * actions even when toolkit_slug=googlecalendar). When omitted,
   * the function returns auth_configs across every connected
   * toolkit (catalog browse path).
   *
   * The filter checks both shapes - the raw display key as stored
   * (e.g. "google-calendar") AND the catalog's `composioAppName`
   * canonical (e.g. "googlecalendar") - because connections can be
   * stored under either depending on the OAuth start path version.
   */
  appFilter?: string,
): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("rgaios_connections")
      .select("provider_config_key, nango_connection_id, metadata")
      .eq("organization_id", organizationId)
      .eq("status", "connected");
    if (error || !data) return [];
    const slug = appFilter?.trim().toLowerCase();
    const canonical = slug ? composioAppNameFor(slug).toLowerCase() : null;
    // Two shapes the connection could match: the raw display key, OR
    // the Composio canonical. A row whose provider_config_key suffix
    // matches EITHER is in scope. Empty slug = match anything.
    const matchesApp = (key: string): boolean => {
      if (!slug) return true;
      const suffix = key.slice(key.indexOf(":") + 1);
      return suffix === slug || (canonical !== null && suffix === canonical);
    };
    const ids = new Set<string>();
    for (const row of data as Array<{
      provider_config_key: string;
      nango_connection_id: string | null;
      metadata: Record<string, unknown> | null;
    }>) {
      // Synthetic auth-config cache row: id lives in nango_connection_id.
      if (
        row.provider_config_key.startsWith("composio-auth-config:") &&
        row.nango_connection_id?.startsWith("ac_") &&
        matchesApp(row.provider_config_key)
      ) {
        ids.add(row.nango_connection_id);
      }
      // Connected-account row for a real toolkit: id lives in metadata.
      if (
        row.provider_config_key.startsWith("composio:") &&
        matchesApp(row.provider_config_key)
      ) {
        const metaId = (row.metadata as { composio_auth_config_id?: string } | null)
          ?.composio_auth_config_id;
        if (typeof metaId === "string" && metaId.startsWith("ac_")) {
          ids.add(metaId);
        }
      }
    }
    return [...ids];
  } catch {
    // Table missing / RLS surprise. Fall through to unscoped catalog.
    return [];
  }
}

// ─── Tool: composio_list_tools (discovery) ──────────────────────────

registerTool({
  name: "composio_list_tools",
  description:
    "List Composio actions available to this user. Pass an `app` slug (e.g. \"slack\", \"gmail\", \"hubspot\") to filter to one toolkit, or omit to fetch the full catalog. Use this before composio_use_tool so you know the exact action name + input shape to call.",
  inputSchema: {
    type: "object",
    properties: {
      app: {
        type: "string",
        description:
          "Optional Composio app slug. Omit or pass \"all\" to list every action across every connected app.",
      },
    },
  },
  handler: async (args, ctx) => {
    // Per-org Composio key first (Connections → Workspace API keys),
    // then env fallback. Mirrors composioCall + composio OAuth start
    // so listing + execution + revoke all hit the same Composio tenant.
    const { resolveComposioApiKey } = await import("@/lib/composio/proxy");
    const apiKey = await resolveComposioApiKey(ctx.organizationId);
    if (!apiKey) {
      return textError(
        "Composio API key missing - set per-org key in Connections → Workspace API keys, or set COMPOSIO_API_KEY env on the VPS",
      );
    }
    // Normalise via composioAppNameFor so display-key inputs
    // ("google-calendar", "google-drive") get mapped to Composio's
    // actual toolkit slugs ("googlecalendar", "googledrive"). The
    // Marti DB stores connections under the display key while
    // Composio's v3 toolkit_slug param expects its canonical
    // dash-free form, which is what surfaced as R-COMPOSIO-3's
    // "EM returned GMAIL actions when app=googlecalendar" error.
    const rawApp = String(args.app ?? "").trim().toLowerCase();
    const normApp = rawApp ? composioAppNameFor(rawApp).toLowerCase() : "";
    const filter = normApp && normApp !== "all" ? normApp : "";

    const cacheKey = `${ctx.organizationId}:${filter || "*"}`;
    const cached = composioListCache.get(cacheKey);
    let items: ComposioActionListItem[];
    if (cached && Date.now() < cached.until) {
      console.info(
        `[composio_list_tools] cache hit org=${ctx.organizationId} filter=${filter || "*"} (${cached.actions.length} actions)`,
      );
      items = cached.actions;
    } else {
      // v3 tools listing. v1 used appNames=, v3 uses toolkit_slug=.
      // Loop with cursor pagination - Composio v3 defaults to 20/page
      // and SLACK_SEND_MESSAGE etc were getting dropped (W6 finding).
      const baseParams = new URLSearchParams();
      if (filter) baseParams.set("toolkit_slug", filter);
      baseParams.set("limit", String(COMPOSIO_PAGE_LIMIT));

      // Scope the discovery call to the org's connected auth configs,
      // the same way composio_use_tool resolves the org's connection
      // before executing. Without this, Composio answered the unscoped
      // request with "isn't connected ... for this org" for some orgs
      // even though the toolkit was genuinely wired. When the org has
      // no Composio connections we leave the param off and fall back to
      // the global catalog so pure discovery / browse still works.
      // Scope by the requested app filter so Composio v3 doesn't
      // return other connected toolkits' tools when this org has
      // gmail + google-calendar + slack all wired (A 00:41 root-cause).
      // Empty filter falls through to the org-wide auth_config list
      // for catalog browse.
      const authConfigIds = await resolveComposioAuthConfigIds(
        ctx.organizationId,
        filter || undefined,
      );
      if (authConfigIds.length > 0) {
        baseParams.set("auth_config_ids", authConfigIds.join(","));
      }

      const aggregated: ComposioActionListItem[] = [];
      let cursor: string | null = null;
      let pages = 0;
      try {
        while (pages < COMPOSIO_MAX_PAGES) {
          const params = new URLSearchParams(baseParams);
          if (cursor) params.set("cursor", cursor);
          const url = `https://backend.composio.dev/api/v3/tools?${params.toString()}`;

          const res = await fetch(url, {
            method: "GET",
            headers: {
              "x-api-key": apiKey,
              "content-type": "application/json",
            },
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) {
            const body = await res.text();
            return textError(
              `composio_list_tools ${res.status}: ${body.slice(0, 300)}`,
            );
          }
          const json = (await res.json()) as ComposioActionListResponse;
          const pageItems = json.items ?? json.actions ?? [];
          aggregated.push(...pageItems);
          pages += 1;

          if (aggregated.length >= COMPOSIO_TOTAL_CAP) break;

          // Cursor lives at top-level (snake or camel) or nested under
          // pagination. Treat empty-string as no-more-pages.
          const next =
            json.next_cursor ??
            json.nextCursor ??
            json.pagination?.next_cursor ??
            json.pagination?.nextCursor ??
            null;
          if (!next || pageItems.length === 0) break;
          cursor = next;
        }
      } catch (err) {
        return textError(
          `composio_list_tools fetch failed: ${(err as Error).message}`,
        );
      }

      items =
        aggregated.length > COMPOSIO_TOTAL_CAP
          ? aggregated.slice(0, COMPOSIO_TOTAL_CAP)
          : aggregated;
      composioListCache.set(cacheKey, {
        actions: items,
        until: Date.now() + LIST_CACHE_TTL_MS,
      });
    }
    if (items.length === 0) {
      return text(
        filter
          ? `No Composio actions found for app "${filter}". Either the slug is wrong or the client hasn't connected this toolkit at /connections.`
          : "Composio returned an empty action catalog. Either COMPOSIO_API_KEY has no toolkits enabled or the request was rate-limited.",
      );
    }

    const header = filter
      ? `Composio actions for app "${filter}" (${items.length}):`
      : `Composio catalog actions (${items.length}). Pass \`app\` to filter:`;

    const lines = items.slice(0, 200).map((it, i) => {
      // v3 returns `slug`; v1 returned `enum`. Tolerate both during the
      // migration window so cached v1 responses still render until the
      // cache TTL clears.
      const slug = it.slug ?? it.enum ?? it.name ?? "(unnamed)";
      const app = it.toolkit?.slug ?? it.appName ?? it.appKey ?? "?";
      const display = it.display_name ?? it.name ?? slug;
      const desc = it.description ? ` - ${it.description.slice(0, 120)}` : "";
      return `${i + 1}. \`${slug}\` (app=${app}) - ${display}${desc}`;
    });

    const truncated =
      items.length > 200
        ? `\n\n(showing first 200 of ${items.length}; pass an \`app\` filter to narrow)`
        : "";

    return text(
      [
        header,
        "",
        "Pass any `slug` value above as `action` to composio_use_tool, plus the input the action expects.",
        "",
        ...lines,
        truncated,
      ].join("\n"),
    );
  },
});

// ─── Defense-in-depth: destructive action denylist ──────────────────
//
// composio_use_tool exposes ~1000 actions to the model. isWrite=true is
// metadata only - /api/mcp does NOT enforce an approval-prompt flow
// today. Until that ships (multi-day item: needs UI, queue, audit), we
// gate by name. Anything matching a destructive keyword is refused;
// agents must request a safe alternative (UPDATE, ARCHIVE, etc).
//
// Patterns deliberately broad: better to false-positive on a benign
// "REMOVE_LABEL" and force the model to pick a more specific safe
// action than to ship DELETE_REPOSITORY by accident.
//
// IMPORTANT: do NOT use `\b` word boundaries here. In JS regex `_` is
// a word character, so `\bDELETE\b` does NOT match `GMAIL_DELETE_MESSAGE`
// (the boundary between `_` and `D` is between two word chars and
// therefore not a boundary at all). Real Composio action enums are
// SCREAMING_SNAKE_CASE separated by `_`, occasionally `-`. We anchor
// the verb on `_`, `-`, start-of-string, or end-of-string so the
// denylist actually catches `GMAIL_DELETE_MESSAGE`, `HUBSPOT_DROP_LIST`,
// `GITHUB_REMOVE_REPO`, `DB_TRUNCATE_TABLE`, etc. The trailing
// `(?:[_\-]|$)` is what keeps `GITHUB_DELETED_REPO_LIST` (verb is
// `DELETED`, not `DELETE`) from false-positive: after `DELETE` comes
// `D`, which is not `_`/`-`/end, so the pattern fails as intended.
const DESTRUCTIVE_ACTION_PATTERNS: RegExp[] = [
  /(?:^|[_\-])DELETE(?:[_\-]|$)/i,
  /(?:^|[_\-])DROP(?:[_\-]|$)/i,
  /(?:^|[_\-])DESTROY(?:[_\-]|$)/i,
  /(?:^|[_\-])PURGE(?:[_\-]|$)/i,
  /(?:^|[_\-])REMOVE(?:[_\-]|$)/i,
  /(?:^|[_\-])WIPE(?:[_\-]|$)/i,
  /(?:^|[_\-])TRUNCATE(?:[_\-]|$)/i,
  // TRASH = Gmail's real delete verb (GMAIL_MOVE_TO_TRASH); REVOKE =
  // credential/grant teardown (GITHUB_REVOKE_TOKEN, etc). Both are
  // destructive and were missing - an injected email could drive
  // GMAIL_MOVE_TO_TRASH past the old 7-verb list.
  /(?:^|[_\-])TRASH(?:[_\-]|$)/i,
  /(?:^|[_\-])REVOKE(?:[_\-]|$)/i,
];

// HOTFIX 10 (2026-05-17, Pedro 16:50 "TU PODE MEXER, SÓ NN ENVIAR
// NADA SACA?" + R-COMPOSIO-1 walk): the destructive denylist
// above false-positives on safe self-cleanup operations like
// GMAIL_DELETE_DRAFT - an unsent draft is the AGENT'S OWN scratch
// space, never an outbound action and never visible to a recipient.
// The R-COMPOSIO-1 walk created a real draft in Marti's mailbox
// and Marta could not clean it up because DELETE matched the
// destructive verb. Allow specific safe-by-design ops through
// EXPLICITLY (do not loosen the destructive regex - we want a
// closed allowlist, not a wider hole).
//
// Each entry must match the FULL action enum (anchored ^ $) so a
// crafted action like "GMAIL_DELETE_DRAFT_AND_SEND" cannot ride
// the allowlist past the denylist.
const SAFE_DESTRUCTIVE_OVERRIDES: RegExp[] = [
  /^GMAIL_DELETE_DRAFT$/i,
  /^GOOGLECALENDAR_DELETE_DRAFT$/i,
  /^OUTLOOK_DELETE_DRAFT$/i,
];

// ─── Tool: composio_use_tool (invoke) ───────────────────────────────

registerTool({
  name: "composio_use_tool",
  description:
    "Invoke any Composio action on behalf of the connected user. Pass `app` (toolkit slug, e.g. \"slack\", \"gmail\", \"hubspot\"), `action` (the ACTION_ENUM string from composio_list_tools), and `input` (object matching that action's expected shape). Routes through the caller's per-user OAuth grant from migration 0063.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      app: {
        type: "string",
        description:
          "Composio app slug, e.g. \"slack\", \"gmail\", \"googlecalendar\", \"hubspot\". Must match a toolkit the client connected at /connections.",
      },
      action: {
        type: "string",
        description:
          "Composio action enum, e.g. \"SLACK_SEND_MESSAGE\". Discover via composio_list_tools.",
      },
      input: {
        type: "object",
        description:
          "Action-specific input payload. Schema varies per action - check composio_list_tools output or Composio docs.",
      },
    },
    required: ["app", "action", "input"],
  },
  handler: async (args, ctx) => {
    // Same display-key -> Composio toolkit-slug normalisation as the
    // list_tools handler. Without this, an agent reading the
    // catalog UI key ("google-calendar") would hit Composio with a
    // dash variant the v3 API doesn't recognise.
    const rawApp = String(args.app ?? "").trim().toLowerCase();
    const app = rawApp ? composioAppNameFor(rawApp).toLowerCase() : "";
    const action = String(args.action ?? "").trim();
    const rawInput = args.input;
    if (!app) return textError("app is required");
    if (!action) return textError("action is required");
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
      return textError("input must be an object matching the action's schema");
    }

    // Defense-in-depth gate (see DESTRUCTIVE_ACTION_PATTERNS above):
    // refuse destructive actions by name until an approval-prompt flow
    // ships. Agents can request UPDATE / ARCHIVE / etc as safe
    // alternatives.
    //
    // HOTFIX 10: the explicit SAFE_DESTRUCTIVE_OVERRIDES allowlist
    // runs first. Anything matching it skips the denylist (the agent
    // legitimately needs to fire e.g. GMAIL_DELETE_DRAFT to clean its
    // own scratch drafts per Pedro's "TU PODE MEXER, SÓ NN ENVIAR
    // NADA" rule). Everything else still hits the deny rules below.
    const safeOverride = SAFE_DESTRUCTIVE_OVERRIDES.some((p) =>
      p.test(action),
    );
    const destructiveMatch = safeOverride
      ? undefined
      : DESTRUCTIVE_ACTION_PATTERNS.find((p) => p.test(action));
    if (destructiveMatch) {
      return textError(
        `composio_use_tool: action ${action} matches denylist ${destructiveMatch.source}; use a more specific safe action or invoke via the dedicated tool`,
      );
    }

    // Per-user OAuth (migration 0063): hit the caller's own connection
    // row first. ToolContext.userId is threaded by the MCP runtime
    // since PR 1 (commit 0149bb9).
    const callerUserId = ctx.userId ?? null;

    // Org-wide approval gate (migration 0067, Chris bug 8) via the
    // shared shouldGateTool() helper. P0-5 S3 unifies what used to be
    // an inline copy here, a parallel copy in registry.ts, and an
    // implicit per-tool write_policy path in executor.ts. Behavior
    // change vs the old inline: this surface now FAILS CLOSED on a
    // transient read failure of approvals_gate_all (parity with
    // registry.ts). The prior inline path silently fell through to
    // execute on read error, leaving the gate bypassed during DB
    // hiccups. createApproval failure still aborts the call.
    const composioToolLabel = `composio:${app}:${action}`;
    const decision = await shouldGateTool(ctx, composioToolLabel, true);
    if (decision.gate) {
      try {
        await createApproval({
          organizationId: ctx.organizationId,
          routineRunId: null,
          agentId: null,
          toolName: composioToolLabel,
          toolArgs: rawInput as Record<string, unknown>,
          reason: decision.reason,
        });
      } catch (approvalErr) {
        // createApproval IS the gate. If it throws (RLS, table missing,
        // write failure) abort the tool call - falling through to
        // execute would bypass the gate entirely.
        console.error(
          `composio_use_tool: createApproval failed under approvals_gate_all, aborting tool execution: ${(approvalErr as Error).message}`,
        );
        return textError(
          `composio_use_tool ${app}/${action}: approval system failed; tool execution aborted (${(approvalErr as Error).message})`,
        );
      }
      return text(
        [
          `Queued for approval: ${app}/${action}.`,
          "An operator needs to approve this at /approvals before it runs.",
          "When approved, the tool re-executes server-side with the same input.",
        ].join("\n"),
      );
    }

    let result: unknown;
    try {
      result = await composioAction(
        ctx.organizationId,
        app,
        action,
        rawInput as Record<string, unknown>,
        callerUserId,
      );
    } catch (err) {
      return textError(
        `composio_use_tool ${app}/${action} failed: ${(err as Error).message}`,
      );
    }

    let serialized: string;
    try {
      serialized = JSON.stringify(result, null, 2);
    } catch {
      serialized = String(result);
    }
    if (serialized.length > 8000) {
      serialized = serialized.slice(0, 8000) + "\n... (truncated)";
    }

    return text(
      [
        `Composio \`${action}\` on app \`${app}\` returned:`,
        "",
        "```json",
        serialized,
        "```",
      ].join("\n"),
    );
  },
});

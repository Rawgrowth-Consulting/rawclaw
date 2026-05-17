import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * F-9: chat-activity heatmap aggregator.
 *
 * Reads the F-5 rgaios_chat_telemetry sink (one row per
 * composeChatPreamble decision) and rolls it up into a fixed
 * 7-day × 24-hour grid keyed by the org's local timezone. The
 * admin /heatmap page renders the grid; ops uses it to spot when
 * an org is busy vs idle and which agents drive peak load.
 *
 * F-9 ships no new schema - it consumes the table F-5 added.
 * Until F-5 merges to v3 the call returns an empty grid (the
 * select error path returns a flat zero matrix, not a throw, so
 * the admin page renders cleanly even before the table exists).
 */

export type HeatmapCell = {
  dow: number; // 0 = Sunday, 6 = Saturday (local tz)
  hour: number; // 0-23 (local tz)
  count: number;
};

export type AgentHeatmap = {
  agentId: string | null;
  agentLabel: string;
  cells: HeatmapCell[]; // dense 168 entries, dow*24 + hour
  total: number;
};

export type HeatmapPayload = {
  windowStart: string; // ISO; inclusive
  windowEnd: string; // ISO; exclusive
  windowDays: HeatmapWindowDays;
  timezone: string;
  agents: AgentHeatmap[];
};

export const HEATMAP_HOURS = 24;
export const HEATMAP_TOP_AGENTS = 10;

/**
 * Supported window sizes for the admin heatmap selector. The grid
 * is always 7×24 (day-of-week × hour) regardless of window length
 * - longer windows accumulate more counts per cell.
 */
export const HEATMAP_WINDOWS = [7, 30, 90] as const;
export type HeatmapWindowDays = (typeof HEATMAP_WINDOWS)[number];
export const HEATMAP_DEFAULT_WINDOW: HeatmapWindowDays = 7;
export const HEATMAP_DAYS = 7; // grid rows, always 7 (one per dow)

export function parseWindowDays(raw: string | null | undefined): HeatmapWindowDays {
  const n = Number.parseInt(raw ?? "", 10);
  if ((HEATMAP_WINDOWS as ReadonlyArray<number>).includes(n)) {
    return n as HeatmapWindowDays;
  }
  return HEATMAP_DEFAULT_WINDOW;
}

type TelemetryWindowRow = {
  agent_id: string | null;
  created_at: string;
};

/**
 * Map a UTC ISO timestamp to (dow, hour) in the target IANA tz.
 * Uses Intl.DateTimeFormat with weekday + hour parts so we never
 * have to roll our own DST math.
 */
export function localDowHour(
  iso: string,
  timezone: string,
): { dow: number; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(iso));
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hourRaw = parts.find((p) => p.type === "hour")?.value ?? "00";
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dow = dowMap[weekday] ?? 0;
  // "24" appears in en-US 23:59 boundary edge for some locales -
  // clamp to 23.
  const hour = Math.min(23, Math.max(0, Number.parseInt(hourRaw, 10) || 0));
  return { dow, hour };
}

/**
 * Pure aggregation: take a flat list of telemetry rows and produce
 * the per-agent dense grid. Kept separate from the supabase call so
 * tests can drive it with synthetic rows.
 */
export function aggregateHeatmap(
  rows: TelemetryWindowRow[],
  timezone: string,
  labelForAgent: (agentId: string | null) => string = (id) =>
    id ? id.slice(0, 8) : "unbound",
): AgentHeatmap[] {
  const byAgent = new Map<string | null, Map<number, number>>();

  for (const row of rows) {
    const { dow, hour } = localDowHour(row.created_at, timezone);
    const key = dow * HEATMAP_HOURS + hour;
    let agentMap = byAgent.get(row.agent_id);
    if (!agentMap) {
      agentMap = new Map();
      byAgent.set(row.agent_id, agentMap);
    }
    agentMap.set(key, (agentMap.get(key) ?? 0) + 1);
  }

  const out: AgentHeatmap[] = [];
  for (const [agentId, cellMap] of byAgent) {
    const cells: HeatmapCell[] = [];
    let total = 0;
    for (let dow = 0; dow < HEATMAP_DAYS; dow += 1) {
      for (let hour = 0; hour < HEATMAP_HOURS; hour += 1) {
        const count = cellMap.get(dow * HEATMAP_HOURS + hour) ?? 0;
        cells.push({ dow, hour, count });
        total += count;
      }
    }
    out.push({
      agentId,
      agentLabel: labelForAgent(agentId),
      cells,
      total,
    });
  }

  out.sort((a, b) => b.total - a.total);
  return out.slice(0, HEATMAP_TOP_AGENTS);
}

/**
 * End-to-end fetch + aggregate. Returns a flat zero matrix on
 * lookup error so the admin page renders before F-5's 0076 lands.
 */
export async function fetchAgentHeatmap(
  orgId: string,
  timezone: string,
  windowDays: HeatmapWindowDays = HEATMAP_DEFAULT_WINDOW,
  now: Date = new Date(),
): Promise<HeatmapPayload> {
  const windowEnd = now;
  const windowStart = new Date(
    windowEnd.getTime() - windowDays * 24 * 60 * 60 * 1000,
  );
  // Longer windows can have more rows; scale the cap roughly so the
  // 90d view still fits in one round-trip.
  const rowCap = Math.min(20_000, 1_000 * windowDays);
  const { data, error } = await supabaseAdmin()
    .from("rgaios_chat_telemetry")
    .select("agent_id, created_at")
    .eq("organization_id", orgId)
    .gte("created_at", windowStart.toISOString())
    .lt("created_at", windowEnd.toISOString())
    .limit(rowCap);
  if (error) {
    console.error("[heatmap] telemetry select failed", error);
    return {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      windowDays,
      timezone,
      agents: [],
    };
  }
  const rows = (data ?? []) as TelemetryWindowRow[];
  const agentIds = [...new Set(rows.map((r) => r.agent_id).filter((id): id is string => Boolean(id)))];
  const labelMap = await resolveAgentLabels(agentIds);
  const agents = aggregateHeatmap(rows, timezone, (id) =>
    id ? labelMap.get(id) ?? id.slice(0, 8) : "unbound",
  );
  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    windowDays,
    timezone,
    agents,
  };
}

async function resolveAgentLabels(
  agentIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (agentIds.length === 0) return out;
  const { data, error } = await supabaseAdmin()
    .from("rgaios_agents")
    .select("id, name")
    .in("id", agentIds);
  if (error || !data) return out;
  for (const row of data as Array<{ id: string; name: string | null }>) {
    out.set(row.id, row.name ?? row.id.slice(0, 8));
  }
  return out;
}

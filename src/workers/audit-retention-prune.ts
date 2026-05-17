/**
 * F-6 v1: audit-log retention prune worker.
 *
 * Calls the SQL helper rgaios_audit_log_prune(retention_days) added
 * in migration 0079 once per tick. Returns the deleted-row count so
 * the cron supervisor can log + alert.
 *
 * Cron wiring: ops attaches runAuditRetentionTick() to the existing
 * rawclaw-tick.timer at a daily cadence (no auto-cron in this PR).
 *
 * Why a worker instead of pg_cron in-migration: the same code path
 * runs the same way against self-hosted Supabase, cloud Supabase
 * and the e2e fixture; pg_cron is not installed on every target.
 */

import { supabaseAdmin } from "@/lib/supabase/server";

const DEFAULT_RETENTION_DAYS = 90;

export type PruneTickResult = {
  deleted: number;
  error?: string;
};

export type PruneTickDeps = {
  /**
   * RPC caller. Default impl hits supabaseAdmin().rpc; spec injects
   * a stub so the unit test doesn't need a Supabase fixture.
   */
  rpc?: (
    fn: "rgaios_audit_log_prune",
    args: { retention_days: number },
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function validateRetentionDays(days: number): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(days)) {
    return { ok: false, error: "retention_days must be an integer" };
  }
  if (days <= 0) {
    return { ok: false, error: "retention_days must be > 0" };
  }
  if (days > 3650) {
    return { ok: false, error: "retention_days cannot exceed 3650 (10 years)" };
  }
  return { ok: true };
}

/**
 * Resolve the deleted-row count regardless of whether Supabase
 * returns it as a bare integer (single-value RPC) or a one-row
 * single-column table. Both shapes are valid for an SQL function
 * returning an integer.
 */
function parseDeletedCount(payload: unknown): number {
  if (typeof payload === "number" && Number.isFinite(payload)) {
    return payload;
  }
  if (Array.isArray(payload) && payload.length > 0) {
    const first = payload[0] as Record<string, unknown> | number;
    if (typeof first === "number") return first;
    if (first && typeof first === "object") {
      for (const v of Object.values(first)) {
        if (typeof v === "number") return v;
      }
    }
  }
  return 0;
}

export async function runAuditRetentionTick(
  retentionDays: number = DEFAULT_RETENTION_DAYS,
  deps: PruneTickDeps = {},
): Promise<PruneTickResult> {
  const validation = validateRetentionDays(retentionDays);
  if (!validation.ok) {
    return { deleted: 0, error: validation.error };
  }

  const rpc =
    deps.rpc ??
    (async (fn, args) => {
      // generated Supabase types regenerate on next typegen pass;
      // until then the rpc name is cast through never (same pattern
      // as src/lib/agent/telemetry.ts uses for new functions).
      const { data, error } = await supabaseAdmin().rpc(
        fn as never,
        args as never,
      );
      return { data, error };
    });

  const { data, error } = await rpc("rgaios_audit_log_prune", {
    retention_days: retentionDays,
  });
  if (error) {
    console.error("[audit-retention] prune RPC failed", error);
    return { deleted: 0, error: error.message };
  }
  return { deleted: parseDeletedCount(data) };
}

export const DEFAULT_AUDIT_RETENTION_DAYS = DEFAULT_RETENTION_DAYS;

/**
 * F-8: daily-insights Telegram digest worker.
 *
 * For each enabled subscription in rgaios_daily_insights_subscriptions
 * where the local time matches send_hour_local and a digest has not
 * yet been sent today (last_sent_at < start-of-today in tz), build a
 * one-message summary of the prior 24h chat-telemetry rows for the
 * org and ship it via the bot token bound to the subscription.
 *
 * Dry-run subscriptions stop after the third send (so ops can eyeball
 * the digest text and either keep iterating or flip dry_run off).
 *
 * Cron wiring is out of scope: the worker exposes
 * `runDailyInsightsTick()` and a CLI entry. Ops wires it from
 * the existing rawclaw-tick.timer (see scripts/provision-vps.sh).
 *
 * Telegram send is injectable so the spec can stub it; default impl
 * uses src/lib/telegram/client.ts.
 */

import { supabaseAdmin } from "@/lib/supabase/server";
import { sendMessage as defaultSendMessage } from "@/lib/telegram/client";
import { tryDecryptSecret } from "@/lib/crypto";

/**
 * Inline subset of the F-5 ChatTelemetryRow shape. We pull a minimal
 * column set here so F-8 ships independent of the F-5 telemetry
 * helper; once F-5 merges to v3, the import can swap to the shared
 * helper. The shapes are deliberately compatible.
 */
export type DigestTelemetryRow = {
  mode: string;
  estimated_tokens: number;
  skipped_block_ids: string[];
  skipped_by_budget: boolean;
};

export type DailyInsightsSubscriptionRow = {
  id: string;
  organization_id: string;
  chat_id: number;
  agent_telegram_bot_id: string;
  timezone: string;
  send_hour_local: number;
  enabled: boolean;
  dry_run: boolean;
  dry_run_sends_remaining: number;
  last_sent_at: string | null;
};

export type SendMessageFn = (
  token: string,
  chatId: number | string,
  text: string,
) => Promise<unknown>;

export type TickDeps = {
  now?: Date;
  sendMessage?: SendMessageFn;
  /**
   * Bot-token resolver. Default impl reads from
   * rgaios_agent_telegram_bots.token where id = bot id. Override
   * lets tests bypass Supabase + supply a synthetic token.
   */
  resolveBotToken?: (botId: string) => Promise<string | null>;
};

export type TickResult = {
  sent: number;
  skipped: number;
  failed: number;
  details: Array<{
    subscriptionId: string;
    outcome: "sent" | "skipped-not-due" | "skipped-already-sent-today" | "skipped-dry-run-exhausted" | "failed";
    reason?: string;
  }>;
};

/**
 * Returns the calendar date string (YYYY-MM-DD) for a moment in a
 * given IANA timezone. Used to decide "has today's digest already
 * been sent in this org's local calendar."
 */
export function localCalendarDate(at: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(at);
}

/**
 * Returns the local hour (0-23) for a moment in a given IANA timezone.
 */
export function localHour(at: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
  return Number.parseInt(hourPart, 10);
}

/**
 * Format the digest body from a window of telemetry rows. Keeps the
 * message under Telegram's 4096-char ceiling by capping summary
 * categories at top-N.
 */
export function formatDigest(
  rows: DigestTelemetryRow[],
  windowLabel: string,
): string {
  if (rows.length === 0) {
    return `📊 Daily insights (${windowLabel})\n\nNo chat activity in the last 24h.`;
  }

  const totalTurns = rows.length;
  const byBudget = rows.filter((r) => r.skipped_by_budget).length;
  const avgEstimated = Math.round(
    rows.reduce((s, r) => s + r.estimated_tokens, 0) / rows.length,
  );
  const avgSkipped = (
    rows.reduce((s, r) => s + r.skipped_block_ids.length, 0) / rows.length
  ).toFixed(1);

  const modeCounts = new Map<string, number>();
  for (const r of rows) {
    modeCounts.set(r.mode, (modeCounts.get(r.mode) ?? 0) + 1);
  }
  const modeLine = [...modeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([m, c]) => `${m} ${c}`)
    .join(" · ");

  return [
    `📊 Daily insights (${windowLabel})`,
    ``,
    `Chat turns: ${totalTurns}`,
    `Avg tokens / turn: ${avgEstimated.toLocaleString("en-US")}`,
    `Avg blocks skipped / turn: ${avgSkipped}`,
    `Turns hit by budget cap: ${byBudget}`,
    `By mode: ${modeLine}`,
  ].join("\n");
}

/**
 * Decide whether a subscription should fire on this tick. A
 * subscription is "due" when:
 *   - enabled
 *   - the local hour matches send_hour_local
 *   - no send has happened today in the org's local calendar date
 *   - if dry_run, dry_run_sends_remaining > 0
 */
export function subscriptionIsDue(
  sub: DailyInsightsSubscriptionRow,
  now: Date,
): { due: boolean; reason?: TickResult["details"][number]["outcome"] } {
  if (!sub.enabled) return { due: false, reason: "skipped-not-due" };
  const hour = localHour(now, sub.timezone);
  if (hour !== sub.send_hour_local) {
    return { due: false, reason: "skipped-not-due" };
  }
  if (sub.dry_run && sub.dry_run_sends_remaining <= 0) {
    return { due: false, reason: "skipped-dry-run-exhausted" };
  }
  if (sub.last_sent_at) {
    const lastLocalDate = localCalendarDate(new Date(sub.last_sent_at), sub.timezone);
    const todayLocalDate = localCalendarDate(now, sub.timezone);
    if (lastLocalDate === todayLocalDate) {
      return { due: false, reason: "skipped-already-sent-today" };
    }
  }
  return { due: true };
}

/**
 * Pull the last 24h of chat-telemetry rows for one org from the
 * persisted sink. Filters on (organization_id, created_at) so each
 * subscription only sees its own org's activity. Caller's clock is
 * the source of truth for the 24h boundary.
 */
async function loadDigestRowsForOrg(
  orgId: string,
  now: Date,
): Promise<DigestTelemetryRow[]> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin()
    .from("rgaios_chat_telemetry")
    .select("mode, estimated_tokens, skipped_block_ids, skipped_by_budget")
    .eq("organization_id", orgId)
    .gte("created_at", since)
    .limit(500);
  if (error) {
    console.error("[daily-insights] loadDigestRowsForOrg failed", error);
    return [];
  }
  return (data ?? []) as DigestTelemetryRow[];
}

async function resolveBotTokenDefault(botId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_agent_telegram_bots")
    .select("bot_token")
    .eq("id", botId)
    .maybeSingle();
  if (error || !data) return null;
  const encrypted = (data as { bot_token: string | null }).bot_token;
  return tryDecryptSecret(encrypted);
}

async function loadDueSubscriptions(): Promise<DailyInsightsSubscriptionRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_daily_insights_subscriptions")
    .select(
      "id, organization_id, chat_id, agent_telegram_bot_id, timezone, send_hour_local, enabled, dry_run, dry_run_sends_remaining, last_sent_at",
    )
    .eq("enabled", true);
  if (error) {
    console.error("[daily-insights] load subscriptions failed", error);
    return [];
  }
  return (data ?? []) as DailyInsightsSubscriptionRow[];
}

async function markSent(
  subscriptionId: string,
  decremented: number | null,
): Promise<void> {
  const update: Record<string, unknown> = { last_sent_at: new Date().toISOString() };
  if (decremented !== null) update.dry_run_sends_remaining = decremented;
  const { error } = await supabaseAdmin()
    .from("rgaios_daily_insights_subscriptions")
    .update(update as never)
    .eq("id", subscriptionId);
  if (error) console.error("[daily-insights] markSent failed", error);
}

/**
 * Worker entrypoint. Iterates due subscriptions, formats the digest,
 * sends it, marks the row as sent. Returns a TickResult summary so
 * the caller (cron or CLI) can log + alert.
 */
export async function runDailyInsightsTick(
  deps: TickDeps = {},
): Promise<TickResult> {
  const now = deps.now ?? new Date();
  const sendMessage = deps.sendMessage ?? defaultSendMessage;
  const resolveBotToken = deps.resolveBotToken ?? resolveBotTokenDefault;

  const subs = await loadDueSubscriptions();
  const result: TickResult = { sent: 0, skipped: 0, failed: 0, details: [] };

  for (const sub of subs) {
    const dueCheck = subscriptionIsDue(sub, now);
    if (!dueCheck.due) {
      result.skipped += 1;
      result.details.push({
        subscriptionId: sub.id,
        outcome: dueCheck.reason ?? "skipped-not-due",
      });
      continue;
    }

    try {
      const token = await resolveBotToken(sub.agent_telegram_bot_id);
      if (!token) {
        result.failed += 1;
        result.details.push({
          subscriptionId: sub.id,
          outcome: "failed",
          reason: "bot token not found",
        });
        continue;
      }
      const rows = await loadDigestRowsForOrg(sub.organization_id, now);
      const text = formatDigest(rows, last24hWindowLabel(now, sub.timezone));
      await sendMessage(token, sub.chat_id, text);
      await markSent(
        sub.id,
        sub.dry_run ? Math.max(0, sub.dry_run_sends_remaining - 1) : null,
      );
      result.sent += 1;
      result.details.push({ subscriptionId: sub.id, outcome: "sent" });
    } catch (err) {
      result.failed += 1;
      result.details.push({
        subscriptionId: sub.id,
        outcome: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

function last24hWindowLabel(now: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    month: "short",
    day: "2-digit",
  });
  return `${fmt.format(new Date(now.getTime() - 24 * 60 * 60 * 1000))} → ${fmt.format(now)}`;
}

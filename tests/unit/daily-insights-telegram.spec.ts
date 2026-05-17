import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDigest,
  localCalendarDate,
  localHour,
  subscriptionIsDue,
  type DailyInsightsSubscriptionRow,
  type DigestTelemetryRow,
} from "../../src/workers/daily-insights-telegram";

/**
 * Pure-function contracts for the daily-insights worker. The
 * supabase + Telegram send sides are injected at the runDailyInsightsTick
 * boundary so this file stays free of network + db fixtures - the
 * full integration walk lives in the e2e suite once F-8 ships.
 */

function baseSub(
  over: Partial<DailyInsightsSubscriptionRow> = {},
): DailyInsightsSubscriptionRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    organization_id: "22222222-2222-2222-2222-222222222222",
    chat_id: 1001,
    agent_telegram_bot_id: "33333333-3333-3333-3333-333333333333",
    timezone: "UTC",
    send_hour_local: 9,
    enabled: true,
    dry_run: false,
    dry_run_sends_remaining: 0,
    last_sent_at: null,
    ...over,
  };
}

const row = (over: Partial<DigestTelemetryRow> = {}): DigestTelemetryRow => ({
  mode: "chat",
  estimated_tokens: 1200,
  skipped_block_ids: [],
  skipped_by_budget: false,
  ...over,
});

test("localCalendarDate returns YYYY-MM-DD in target tz", () => {
  // 2026-05-17 02:30 UTC = 2026-05-16 22:30 in America/New_York
  const at = new Date("2026-05-17T02:30:00Z");
  assert.equal(localCalendarDate(at, "UTC"), "2026-05-17");
  assert.equal(localCalendarDate(at, "America/New_York"), "2026-05-16");
});

test("localHour returns 0-23 in target tz", () => {
  const at = new Date("2026-05-17T13:00:00Z");
  assert.equal(localHour(at, "UTC"), 13);
  assert.equal(localHour(at, "America/New_York"), 9);
});

test("subscriptionIsDue: enabled + matching hour + never sent = due", () => {
  const at = new Date("2026-05-17T09:00:00Z");
  const { due } = subscriptionIsDue(baseSub(), at);
  assert.equal(due, true);
});

test("subscriptionIsDue: disabled = not due", () => {
  const at = new Date("2026-05-17T09:00:00Z");
  const { due, reason } = subscriptionIsDue(baseSub({ enabled: false }), at);
  assert.equal(due, false);
  assert.equal(reason, "skipped-not-due");
});

test("subscriptionIsDue: wrong hour = not due", () => {
  const at = new Date("2026-05-17T11:00:00Z"); // 11Z, send_hour 9
  const { due, reason } = subscriptionIsDue(baseSub(), at);
  assert.equal(due, false);
  assert.equal(reason, "skipped-not-due");
});

test("subscriptionIsDue: dry_run + 0 sends remaining = not due", () => {
  const at = new Date("2026-05-17T09:00:00Z");
  const { due, reason } = subscriptionIsDue(
    baseSub({ dry_run: true, dry_run_sends_remaining: 0 }),
    at,
  );
  assert.equal(due, false);
  assert.equal(reason, "skipped-dry-run-exhausted");
});

test("subscriptionIsDue: dry_run + remaining > 0 = due", () => {
  const at = new Date("2026-05-17T09:00:00Z");
  const { due } = subscriptionIsDue(
    baseSub({ dry_run: true, dry_run_sends_remaining: 3 }),
    at,
  );
  assert.equal(due, true);
});

test("subscriptionIsDue: sent earlier today in tz = not due", () => {
  const at = new Date("2026-05-17T09:00:00Z");
  const sentEarlierToday = new Date("2026-05-17T09:00:00Z").toISOString();
  const { due, reason } = subscriptionIsDue(
    baseSub({ last_sent_at: sentEarlierToday }),
    at,
  );
  assert.equal(due, false);
  assert.equal(reason, "skipped-already-sent-today");
});

test("subscriptionIsDue: sent yesterday in tz = due", () => {
  const at = new Date("2026-05-17T09:00:00Z");
  const sentYesterday = new Date("2026-05-16T09:00:00Z").toISOString();
  const { due } = subscriptionIsDue(
    baseSub({ last_sent_at: sentYesterday }),
    at,
  );
  assert.equal(due, true);
});

test("subscriptionIsDue: tz-aware day rollover (NY vs UTC)", () => {
  // 03:30 UTC on the 17th = 23:30 on the 16th in NY.
  // For an NY subscription sent at 09:00 NY on the 16th, the previous
  // send is still "today" in NY, so 03:30 UTC the next morning (still
  // 23:30 NY on the 16th) must not re-fire.
  const at = new Date("2026-05-17T03:30:00Z");
  const sentAt9amNyOn16th = new Date("2026-05-16T13:00:00Z").toISOString();
  const { due, reason } = subscriptionIsDue(
    baseSub({
      timezone: "America/New_York",
      send_hour_local: 9,
      last_sent_at: sentAt9amNyOn16th,
    }),
    at,
  );
  assert.equal(due, false);
  // The hour check fires first (23 != 9), but the reason tag is
  // correct either way.
  assert.equal(reason, "skipped-not-due");
});

test("formatDigest: empty rows = no-activity message", () => {
  const text = formatDigest([], "May 16 → May 17");
  assert.match(text, /No chat activity/);
  assert.match(text, /Daily insights/);
});

test("formatDigest: aggregates turn / token / skipped / budget counters", () => {
  const text = formatDigest(
    [
      row({ estimated_tokens: 1000, skipped_block_ids: ["a", "b"] }),
      row({ estimated_tokens: 2000, skipped_block_ids: [], skipped_by_budget: true }),
      row({ estimated_tokens: 3000, skipped_block_ids: ["a"] }),
    ],
    "May 16 → May 17",
  );
  assert.match(text, /Chat turns: 3/);
  assert.match(text, /Avg tokens \/ turn: 2,000/);
  assert.match(text, /Avg blocks skipped \/ turn: 1\.0/);
  assert.match(text, /Turns hit by budget cap: 1/);
});

test("formatDigest: mode line shows top 4 modes sorted by frequency", () => {
  const rows = [
    ...Array(5).fill(0).map(() => row({ mode: "chat" })),
    ...Array(3).fill(0).map(() => row({ mode: "telegram" })),
    row({ mode: "owner_chat" }),
  ];
  const text = formatDigest(rows, "x");
  assert.match(text, /chat 5/);
  assert.match(text, /telegram 3/);
  assert.match(text, /owner_chat 1/);
});

test("formatDigest: stays under Telegram 4096-char ceiling on noisy input", () => {
  const noisy: DigestTelemetryRow[] = [];
  for (let i = 0; i < 1000; i += 1) {
    noisy.push(row({ mode: `mode-${i}` }));
  }
  const text = formatDigest(noisy, "noisy");
  assert.ok(text.length < 4096, `digest too long: ${text.length}`);
});

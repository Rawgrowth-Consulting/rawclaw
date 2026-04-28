import { test } from "node:test";
import assert from "node:assert/strict";
import { CronExpressionParser } from "cron-parser";

import {
  HEARTBEAT_TRIGGER_CRON,
  HEARTBEAT_TRIGGER_MARKER,
} from "../../src/lib/routines/autonomous-heartbeat";

/**
 * Surface-level guarantees for the autonomous-heartbeat seed.
 *
 * The full seed path needs a live Supabase + an organization with at
 * least one department-head agent, so it lives in cloud smoke. These
 * tests pin the contract pieces that schedule-tick + the audit reader
 * rely on:
 *   1. The marker key matches what schedule-tick checks for.
 *   2. The cron string parses with cron-parser (the same library
 *      schedule-tick uses) and yields a fire interval of about 2 min.
 *   3. The cron expression fires more than once per 5-minute window
 *      so the brief §9.6 1h-idle test produces multiple events.
 */

test("heartbeat marker key matches schedule-tick recogniser", () => {
  // schedule-tick reads this key off the trigger config to label the
  // fire as autonomous in its summary. If you rename one, rename both.
  assert.equal(HEARTBEAT_TRIGGER_MARKER, "autonomous_heartbeat");
});

test("heartbeat cron parses cleanly with cron-parser (the schedule-tick parser)", () => {
  const it = CronExpressionParser.parse(HEARTBEAT_TRIGGER_CRON, {
    tz: "UTC",
    currentDate: new Date("2026-04-28T12:00:00Z"),
  });
  const next = it.next().toDate();
  // Either :00 or :02 depending on whether currentDate sits exactly on
  // a slot boundary - both are valid for the */2 schedule.
  assert.ok(
    next.getUTCMinutes() % 2 === 0,
    `expected even minute, got ${next.getUTCMinutes()}`,
  );
});

test("heartbeat fires at least 5 times per 10-minute window (idle activity floor)", () => {
  const start = new Date("2026-04-28T12:00:00Z");
  const it = CronExpressionParser.parse(HEARTBEAT_TRIGGER_CRON, {
    tz: "UTC",
    currentDate: start,
  });
  const fires: Date[] = [];
  for (let i = 0; i < 5; i++) fires.push(it.next().toDate());
  const elapsedMs = fires[4].getTime() - start.getTime();
  // 5 fires of */2 should land within roughly 10 minutes (slop for slot
  // alignment). Brief §9.6 needs at least one fire per ~5 minutes per
  // manager so a 1h idle test produces a visible heartbeat trail.
  assert.ok(
    elapsedMs <= 12 * 60 * 1000,
    `5 heartbeat fires took ${elapsedMs}ms, expected <= 12 min`,
  );
});

test("heartbeat cron is exactly */2 - 1-minute is too noisy, 5-minute too slow", () => {
  // Pinned literal so a future drive-by edit can't widen the window
  // without flipping this test red and forcing a deliberate review.
  assert.equal(HEARTBEAT_TRIGGER_CRON, "*/2 * * * *");
});

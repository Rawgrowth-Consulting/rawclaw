import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateHeatmap,
  HEATMAP_DAYS,
  HEATMAP_HOURS,
  HEATMAP_TOP_AGENTS,
  localDowHour,
} from "../../src/lib/agent/heatmap";

/**
 * Pure-function contracts for the heatmap aggregator. The supabase
 * read path is covered by an e2e walk once F-9 deploys; this file
 * pins the math + tz behavior the page depends on.
 */

test("localDowHour: 2026-05-17 02:30 UTC = Sun 02 in UTC", () => {
  const { dow, hour } = localDowHour("2026-05-17T02:30:00Z", "UTC");
  assert.equal(dow, 0);
  assert.equal(hour, 2);
});

test("localDowHour: 2026-05-17 02:30 UTC = Sat 22 in America/New_York", () => {
  const { dow, hour } = localDowHour("2026-05-17T02:30:00Z", "America/New_York");
  assert.equal(dow, 6);
  assert.equal(hour, 22);
});

test("localDowHour: clamps hour to 0-23 range", () => {
  const { hour } = localDowHour("2026-05-17T23:59:59Z", "UTC");
  assert.ok(hour >= 0 && hour <= 23, `hour ${hour} out of range`);
});

test("aggregateHeatmap: empty input = empty agent list", () => {
  const out = aggregateHeatmap([], "UTC");
  assert.deepEqual(out, []);
});

test("aggregateHeatmap: each agent emits dense 168-cell grid", () => {
  const out = aggregateHeatmap(
    [{ agent_id: "a", created_at: "2026-05-17T03:00:00Z" }],
    "UTC",
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].cells.length, HEATMAP_DAYS * HEATMAP_HOURS);
});

test("aggregateHeatmap: cells aggregate by (dow, hour) in tz", () => {
  const out = aggregateHeatmap(
    [
      { agent_id: "a", created_at: "2026-05-17T03:00:00Z" }, // Sun 03 UTC
      { agent_id: "a", created_at: "2026-05-17T03:30:00Z" }, // Sun 03 UTC
      { agent_id: "a", created_at: "2026-05-17T04:00:00Z" }, // Sun 04 UTC
    ],
    "UTC",
  );
  assert.equal(out.length, 1);
  const sun03 = out[0].cells.find((c) => c.dow === 0 && c.hour === 3);
  const sun04 = out[0].cells.find((c) => c.dow === 0 && c.hour === 4);
  assert.equal(sun03?.count, 2);
  assert.equal(sun04?.count, 1);
});

test("aggregateHeatmap: total per agent = sum of cells", () => {
  const out = aggregateHeatmap(
    [
      { agent_id: "a", created_at: "2026-05-17T03:00:00Z" },
      { agent_id: "a", created_at: "2026-05-17T04:00:00Z" },
      { agent_id: "a", created_at: "2026-05-17T05:00:00Z" },
    ],
    "UTC",
  );
  assert.equal(out[0].total, 3);
});

test("aggregateHeatmap: sorted by total descending", () => {
  const out = aggregateHeatmap(
    [
      { agent_id: "a", created_at: "2026-05-17T03:00:00Z" },
      { agent_id: "b", created_at: "2026-05-17T03:00:00Z" },
      { agent_id: "b", created_at: "2026-05-17T04:00:00Z" },
      { agent_id: "b", created_at: "2026-05-17T05:00:00Z" },
    ],
    "UTC",
  );
  assert.equal(out[0].agentId, "b");
  assert.equal(out[0].total, 3);
  assert.equal(out[1].agentId, "a");
  assert.equal(out[1].total, 1);
});

test("aggregateHeatmap: top 10 cap (HEATMAP_TOP_AGENTS)", () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({
    agent_id: `agent-${i}`,
    created_at: "2026-05-17T03:00:00Z",
  }));
  const out = aggregateHeatmap(rows, "UTC");
  assert.equal(out.length, HEATMAP_TOP_AGENTS);
});

test("aggregateHeatmap: null agent_id bucket separately", () => {
  const out = aggregateHeatmap(
    [
      { agent_id: null, created_at: "2026-05-17T03:00:00Z" },
      { agent_id: "a", created_at: "2026-05-17T03:00:00Z" },
    ],
    "UTC",
  );
  assert.equal(out.length, 2);
  const unbound = out.find((a) => a.agentId === null);
  assert.equal(unbound?.total, 1);
  assert.equal(unbound?.agentLabel, "unbound");
});

test("aggregateHeatmap: labelForAgent injection overrides default slice", () => {
  const out = aggregateHeatmap(
    [{ agent_id: "abcdef0123456789", created_at: "2026-05-17T03:00:00Z" }],
    "UTC",
    () => "Custom Label",
  );
  assert.equal(out[0].agentLabel, "Custom Label");
});

test("aggregateHeatmap: tz shift moves rows across day boundary", () => {
  // 2026-05-17 02:30 UTC = Sat 22:30 in NY → cell (Sat, 22)
  const out = aggregateHeatmap(
    [{ agent_id: "a", created_at: "2026-05-17T02:30:00Z" }],
    "America/New_York",
  );
  const sat22 = out[0].cells.find((c) => c.dow === 6 && c.hour === 22);
  assert.equal(sat22?.count, 1);
  const sun02 = out[0].cells.find((c) => c.dow === 0 && c.hour === 2);
  assert.equal(sun02?.count, 0);
});

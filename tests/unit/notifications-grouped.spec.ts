import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GROUP_LATEST_CAP,
  groupNotifications,
  labelForKind,
  totalUnread,
  type BellNotification,
} from "../../src/lib/notifications/grouping";

const n = (over: Partial<BellNotification> = {}): BellNotification => ({
  id: "id-" + Math.random(),
  agent_id: "agent",
  agent_name: "Agent",
  content: "msg",
  created_at: "2026-05-17T02:00:00Z",
  kind: "message",
  ...over,
});

test("groupNotifications: empty input = empty groups", () => {
  assert.deepEqual(groupNotifications([]), []);
});

test("groupNotifications: single kind = single group", () => {
  const out = groupNotifications([
    n({ kind: "proactive_anomaly" }),
    n({ kind: "proactive_anomaly" }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "proactive_anomaly");
  assert.equal(out[0].count, 2);
});

test("groupNotifications: ordered Coordination -> Anomaly -> Data ask -> Message", () => {
  const out = groupNotifications([
    n({ kind: "data_ask" }),
    n({ kind: "atlas_coordinate" }),
    n({ kind: "message" }),
    n({ kind: "proactive_anomaly" }),
  ]);
  assert.deepEqual(
    out.map((g) => g.kind),
    ["atlas_coordinate", "proactive_anomaly", "data_ask", "message"],
  );
});

test("groupNotifications: unknown kind buckets into message", () => {
  const out = groupNotifications([n({ kind: "telemetry_drift" })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "message");
});

test("groupNotifications: empty buckets dropped", () => {
  const out = groupNotifications([n({ kind: "data_ask" })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "data_ask");
});

test("groupNotifications: per-group latest cap (GROUP_LATEST_CAP)", () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    n({ id: `x-${i}`, kind: "proactive_anomaly" }),
  );
  const out = groupNotifications(many);
  assert.equal(out[0].count, 20);
  assert.equal(out[0].latest.length, GROUP_LATEST_CAP);
});

test("groupNotifications: preserves input order within bucket", () => {
  const out = groupNotifications([
    n({ id: "first", kind: "data_ask" }),
    n({ id: "second", kind: "data_ask" }),
    n({ id: "third", kind: "data_ask" }),
  ]);
  assert.deepEqual(
    out[0].latest.map((x) => x.id),
    ["first", "second", "third"],
  );
});

test("totalUnread: sums counts across groups", () => {
  const out = groupNotifications([
    n({ kind: "data_ask" }),
    n({ kind: "proactive_anomaly" }),
    n({ kind: "proactive_anomaly" }),
  ]);
  assert.equal(totalUnread(out), 3);
});

test("totalUnread: empty = 0", () => {
  assert.equal(totalUnread([]), 0);
});

test("labelForKind: each kind has a human label", () => {
  assert.equal(labelForKind("atlas_coordinate"), "Coordination");
  assert.equal(labelForKind("proactive_anomaly"), "Anomaly");
  assert.equal(labelForKind("data_ask"), "Data ask");
  assert.equal(labelForKind("message"), "Message");
});

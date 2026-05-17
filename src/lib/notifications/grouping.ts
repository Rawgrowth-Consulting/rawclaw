/**
 * F-2: bell-grouped notification aggregator. Pure function so the
 * spec drives it with synthetic rows. The route + UI both call
 * this so the shape stays consistent.
 *
 * Today's bell payload (api/notifications/agents) is a flat list
 * filtered to three metadata.kind values (proactive_anomaly,
 * data_ask, atlas_coordinate). This helper rebuckets that list by
 * kind into a small array the dropdown can render section-by-
 * section instead of one undifferentiated stream.
 */

export type NotificationKind =
  | "proactive_anomaly"
  | "data_ask"
  | "atlas_coordinate"
  | "message";

export type BellNotification = {
  id: string;
  agent_id: string;
  agent_name: string;
  content: string;
  created_at: string;
  kind: string;
};

export type NotificationGroup = {
  kind: NotificationKind;
  label: string;
  count: number;
  latest: BellNotification[]; // most recent first, capped per group
};

const KIND_ORDER: ReadonlyArray<NotificationKind> = [
  "atlas_coordinate",
  "proactive_anomaly",
  "data_ask",
  "message",
];

const KIND_LABEL: Record<NotificationKind, string> = {
  atlas_coordinate: "Coordination",
  proactive_anomaly: "Anomaly",
  data_ask: "Data ask",
  message: "Message",
};

export const GROUP_LATEST_CAP = 5;

function asKind(s: string): NotificationKind {
  if (
    s === "proactive_anomaly" ||
    s === "data_ask" ||
    s === "atlas_coordinate"
  ) {
    return s;
  }
  return "message";
}

export function labelForKind(kind: NotificationKind): string {
  return KIND_LABEL[kind];
}

/**
 * Bucket notifications by kind. Preserves intra-bucket order
 * (caller is responsible for sorting input most-recent-first).
 * Returned groups follow KIND_ORDER so the dropdown always lists
 * Coordination → Anomaly → Data ask → Message - the operator's
 * mental model of "what needs my eyes most" first.
 *
 * Empty groups are dropped so a clean inbox doesn't show 4 empty
 * sections.
 */
export function groupNotifications(
  notifications: BellNotification[],
): NotificationGroup[] {
  const byKind = new Map<NotificationKind, BellNotification[]>();
  for (const n of notifications) {
    const k = asKind(n.kind);
    let bucket = byKind.get(k);
    if (!bucket) {
      bucket = [];
      byKind.set(k, bucket);
    }
    bucket.push(n);
  }

  const out: NotificationGroup[] = [];
  for (const k of KIND_ORDER) {
    const bucket = byKind.get(k);
    if (!bucket || bucket.length === 0) continue;
    out.push({
      kind: k,
      label: KIND_LABEL[k],
      count: bucket.length,
      latest: bucket.slice(0, GROUP_LATEST_CAP),
    });
  }
  return out;
}

/**
 * Sum of unread counts across groups. Drives the badge number.
 */
export function totalUnread(groups: NotificationGroup[]): number {
  return groups.reduce((s, g) => s + g.count, 0);
}

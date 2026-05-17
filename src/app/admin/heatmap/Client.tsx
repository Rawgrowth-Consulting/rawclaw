"use client";

import { Fragment, useMemo, useState } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/swr";
import type { ActivityHeatmapPayload } from "./page";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function colorForIntensity(count: number, max: number): string {
  if (max <= 0 || count === 0) return "bg-muted/10";
  const ratio = count / max;
  if (ratio < 0.15) return "bg-blue-900/30";
  if (ratio < 0.35) return "bg-blue-700/50";
  if (ratio < 0.6) return "bg-blue-500/60";
  if (ratio < 0.85) return "bg-blue-400/70";
  return "bg-blue-300/80";
}

function fmtRange(startIso: string, endIso: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
  });
  return `${fmt.format(new Date(startIso))} → ${fmt.format(new Date(endIso))}`;
}

/**
 * Admin /heatmap grid. One section per top agent. Each cell shows
 * the turn count; intensity scales per-agent so a quiet agent
 * still reads.
 */
export function HeatmapClient({
  initial,
  timezone,
}: {
  initial: ActivityHeatmapPayload;
  timezone: string;
}) {
  const url = `/api/admin/heatmap?tz=${encodeURIComponent(timezone)}`;
  const { data } = useSWR<ActivityHeatmapPayload>(url, jsonFetcher, {
    fallbackData: initial,
    refreshInterval: 60_000,
    refreshWhenHidden: false,
    revalidateOnMount: false,
  });
  const payload = data ?? initial;
  const [expanded, setExpanded] = useState<string | null>(null);

  const hourLabels = useMemo(
    () =>
      Array.from({ length: 24 }, (_, h) =>
        h % 3 === 0 ? String(h).padStart(2, "0") : "",
      ),
    [],
  );

  if (payload.agents.length === 0) {
    return (
      <div className="rounded border border-border p-6 text-sm text-muted-foreground">
        No chat activity in the last 7 days. The heatmap populates
        once <code>rgaios_chat_telemetry</code> has rows (F-5 migration
        0076 must be applied; trigger a chat or telegram message to
        seed data).
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-xs text-muted-foreground">
        Window {fmtRange(payload.windowStart, payload.windowEnd)} · tz{" "}
        <span className="font-mono">{payload.timezone}</span> · top{" "}
        {payload.agents.length} agents
      </div>
      {payload.agents.map((agent) => {
        const key = agent.agentId ?? "unbound";
        const max = agent.cells.reduce((m, c) => (c.count > m ? c.count : m), 0);
        const isExpanded = expanded === key;
        return (
          <section key={key} className="rounded border border-border">
            <header
              onClick={() => setExpanded(isExpanded ? null : key)}
              className="cursor-pointer flex items-center justify-between px-3 py-2 bg-muted/30 text-sm"
            >
              <span className="font-semibold">{agent.agentLabel}</span>
              <span className="text-xs text-muted-foreground">
                {agent.total.toLocaleString("en-US")} turns · peak {max}
              </span>
            </header>
            {isExpanded ? (
              <HeatGrid cells={agent.cells} max={max} hourLabels={hourLabels} />
            ) : (
              <HeatGrid cells={agent.cells} max={max} hourLabels={hourLabels} compact />
            )}
          </section>
        );
      })}
    </div>
  );
}

function HeatGrid({
  cells,
  max,
  hourLabels,
  compact = false,
}: {
  cells: { dow: number; hour: number; count: number }[];
  max: number;
  hourLabels: string[];
  compact?: boolean;
}) {
  const cellSize = compact ? "h-3 w-3" : "h-5 w-5";
  return (
    <div className="overflow-x-auto p-3">
      <div className="inline-grid grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-[2px] text-[10px]">
        <div />
        {hourLabels.map((label, h) => (
          <div key={h} className="text-center text-muted-foreground">
            {label}
          </div>
        ))}
        {DAY_LABELS.map((label, dow) => (
          <Fragment key={dow}>
            <div className="pr-2 text-right text-muted-foreground self-center">
              {label}
            </div>
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = cells[dow * 24 + hour];
              const count = cell?.count ?? 0;
              return (
                <div
                  key={hour}
                  title={`${label} ${String(hour).padStart(2, "0")}:00 · ${count} turn${count === 1 ? "" : "s"}`}
                  className={`${cellSize} rounded-sm ${colorForIntensity(count, max)}`}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

"use client";

import { Fragment, useMemo, useState } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/swr";
import { HEATMAP_WINDOWS, type HeatmapWindowDays } from "@/lib/agent/heatmap";
import type { ActivityHeatmapPayload } from "./page";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const INTENSITY_BANDS = [
  { upTo: 0, label: "none", className: "bg-muted/10" },
  { upTo: 0.15, label: "low", className: "bg-blue-900/30" },
  { upTo: 0.35, label: "mid-low", className: "bg-blue-700/50" },
  { upTo: 0.6, label: "mid", className: "bg-blue-500/60" },
  { upTo: 0.85, label: "high", className: "bg-blue-400/70" },
  { upTo: 1, label: "peak", className: "bg-blue-300/80" },
] as const;

function colorForIntensity(count: number, max: number): string {
  if (max <= 0 || count === 0) return INTENSITY_BANDS[0].className;
  const ratio = count / max;
  for (const band of INTENSITY_BANDS.slice(1)) {
    if (ratio < band.upTo) return band.className;
  }
  return INTENSITY_BANDS[INTENSITY_BANDS.length - 1].className;
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
 * still reads. F-9 polish (B 01:59): adds window selector + legend.
 */
export function HeatmapClient({
  initial,
  timezone,
}: {
  initial: ActivityHeatmapPayload;
  timezone: string;
}) {
  const [windowDays, setWindowDays] = useState<HeatmapWindowDays>(
    initial.windowDays,
  );
  const url = `/api/admin/heatmap?tz=${encodeURIComponent(timezone)}&days=${windowDays}`;
  const { data, isLoading } = useSWR<ActivityHeatmapPayload>(url, jsonFetcher, {
    fallbackData: windowDays === initial.windowDays ? initial : undefined,
    refreshInterval: 60_000,
    refreshWhenHidden: false,
    revalidateOnMount: windowDays !== initial.windowDays,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <WindowSelector value={windowDays} onChange={setWindowDays} loading={isLoading} />
        <IntensityLegend />
        <div className="ml-auto text-xs text-muted-foreground">
          {fmtRange(payload.windowStart, payload.windowEnd)} · tz{" "}
          <span className="font-mono">{payload.timezone}</span>
          {payload.agents.length > 0
            ? ` · top ${payload.agents.length} agents`
            : ""}
        </div>
      </div>

      {payload.agents.length === 0 ? (
        <div className="rounded border border-border p-6 text-sm text-muted-foreground">
          No chat activity in the last {windowDays} days. The heatmap
          populates once <code>rgaios_chat_telemetry</code> has rows
          (F-5 migration 0076 must be applied; trigger a chat or
          telegram message to seed data).
        </div>
      ) : (
        payload.agents.map((agent) => {
          const key = agent.agentId ?? "unbound";
          const max = agent.cells.reduce(
            (m, c) => (c.count > m ? c.count : m),
            0,
          );
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
              <HeatGrid
                cells={agent.cells}
                max={max}
                hourLabels={hourLabels}
                compact={!isExpanded}
              />
            </section>
          );
        })
      )}
    </div>
  );
}

function WindowSelector({
  value,
  onChange,
  loading,
}: {
  value: HeatmapWindowDays;
  onChange: (v: HeatmapWindowDays) => void;
  loading: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded border border-border bg-muted/20 p-1 text-xs">
      <span className="px-2 text-muted-foreground">Window</span>
      {HEATMAP_WINDOWS.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          className={`rounded px-2 py-1 font-mono ${
            d === value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted/40"
          }`}
        >
          {d}d
        </button>
      ))}
      {loading ? (
        <span className="ml-1 animate-pulse text-muted-foreground">…</span>
      ) : null}
    </div>
  );
}

function IntensityLegend() {
  return (
    <div className="inline-flex items-center gap-2 rounded border border-border bg-muted/20 px-2 py-1 text-xs">
      <span className="text-muted-foreground">Intensity</span>
      <div className="flex items-center gap-[2px]">
        {INTENSITY_BANDS.map((band) => (
          <span
            key={band.label}
            title={band.label}
            className={`h-3 w-4 rounded-sm ${band.className}`}
          />
        ))}
      </div>
      <span className="text-muted-foreground">low → peak</span>
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

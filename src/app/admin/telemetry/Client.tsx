"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/swr";
import type { TelemetryRow } from "./page";

const COLUMNS = [
  { key: "when", label: "When", align: "text-left" as const },
  { key: "mode", label: "Mode", align: "text-left" as const },
  { key: "agent", label: "Agent", align: "text-left" as const },
  { key: "selected", label: "Selected", align: "text-right" as const },
  { key: "skipped", label: "Skipped", align: "text-right" as const },
  { key: "tokens", label: "Tokens", align: "text-right" as const },
  { key: "budget", label: "Budget", align: "text-right" as const },
  { key: "msgs", label: "Msgs", align: "text-right" as const },
  { key: "byBudget", label: "By budget?", align: "text-left" as const },
];

const FILTER_DEBOUNCE_MS = 250;

function fmtTs(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function fmtBudget(n: number): string {
  return n < 0 ? "inf" : n.toLocaleString();
}

function shortAgent(id: string | null): string {
  return id ? id.slice(0, 8) : "—";
}

/**
 * Admin /telemetry table. Polls /api/admin/telemetry every 10s
 * (suspended when tab hidden). Filter input debounces 250ms before
 * threading into the SWR key so each keystroke doesn't spawn a
 * fetch + cache entry. Rows are click-to-expand to reveal the
 * full selected/skipped block id lists.
 */
export function TelemetryClient({ initial }: { initial: TelemetryRow[] }) {
  const [filterDraft, setFilterDraft] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = filterDraft.trim();
    if (trimmed === agentFilter) return;
    const t = window.setTimeout(() => setAgentFilter(trimmed), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [filterDraft, agentFilter]);

  const url = agentFilter
    ? `/api/admin/telemetry?agent=${encodeURIComponent(agentFilter)}`
    : "/api/admin/telemetry";
  const { data } = useSWR<{ rows: TelemetryRow[] }>(url, jsonFetcher, {
    fallbackData: { rows: initial },
    refreshInterval: 10_000,
    refreshWhenHidden: false,
    revalidateOnMount: false,
  });
  const rows = data?.rows ?? initial;

  const colSpan = useMemo(() => COLUMNS.length, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Filter by agent_id (uuid)"
          value={filterDraft}
          onChange={(e) => setFilterDraft(e.target.value)}
          className="w-96 rounded border border-border bg-background px-3 py-2 text-sm font-mono"
        />
        <span className="text-xs text-muted-foreground">
          Showing {rows.length} most recent. Refresh 10s.
        </span>
      </div>

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className={`px-3 py-2 ${c.align}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const expanded = r.id === expandedId;
              return (
                <Fragment key={r.id}>
                  <tr
                    onClick={() => setExpandedId(expanded ? null : r.id)}
                    className="cursor-pointer border-t border-border hover:bg-muted/20"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {fmtTs(r.created_at)}
                    </td>
                    <td className="px-3 py-2">{r.mode}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {shortAgent(r.agent_id)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.selected_block_ids.length}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.skipped_block_ids.length}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.estimated_tokens.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {fmtBudget(r.budget_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.message_count ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {r.skipped_by_budget ? (
                        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200">
                          yes
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">no</span>
                      )}
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="border-t border-border bg-muted/10">
                      <td colSpan={colSpan} className="px-3 py-3">
                        <div className="grid grid-cols-2 gap-6 text-xs">
                          <div>
                            <div className="mb-1 font-semibold uppercase text-muted-foreground">
                              Selected ({r.selected_block_ids.length})
                            </div>
                            <div className="font-mono text-xs leading-relaxed">
                              {r.selected_block_ids.join(", ") || "—"}
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 font-semibold uppercase text-muted-foreground">
                              Skipped ({r.skipped_block_ids.length})
                            </div>
                            <div className="font-mono text-xs leading-relaxed">
                              {r.skipped_block_ids.join(", ") || "—"}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-3 py-8 text-center text-muted-foreground">
                  No telemetry rows yet. Trigger a chat or telegram message and refresh.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

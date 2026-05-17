"use client";

import { Fragment, useState } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/swr";
import type { TelemetryRow } from "./page";

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

export function TelemetryClient({ initial }: { initial: TelemetryRow[] }) {
  const [agentFilter, setAgentFilter] = useState("");
  const url = agentFilter
    ? `/api/admin/telemetry?agent=${encodeURIComponent(agentFilter)}`
    : "/api/admin/telemetry";
  const { data } = useSWR<{ rows: TelemetryRow[] }>(url, jsonFetcher, {
    fallbackData: { rows: initial },
    refreshInterval: 10_000,
  });
  const rows = data?.rows ?? initial;

  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Filter by agent_id (uuid)"
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value.trim())}
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
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Mode</th>
              <th className="px-3 py-2 text-left">Agent</th>
              <th className="px-3 py-2 text-right">Selected</th>
              <th className="px-3 py-2 text-right">Skipped</th>
              <th className="px-3 py-2 text-right">Tokens</th>
              <th className="px-3 py-2 text-right">Budget</th>
              <th className="px-3 py-2 text-right">Msgs</th>
              <th className="px-3 py-2 text-left">By budget?</th>
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
                      {r.agent_id ? r.agent_id.slice(0, 8) : "—"}
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
                      <td colSpan={9} className="px-3 py-3">
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
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
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

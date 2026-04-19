"use client";

import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { jsonFetcher } from "@/lib/swr";

type Stats = {
  activeAgents: number;
  totalAgents: number;
  activelyRunning: number;
  openIssues: number;
  pendingApprovals: number;
  spendMonthUsd: number;
};

function formatUsd(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function DashboardStats() {
  const { data } = useSWR<Stats>("/api/dashboard/stats", jsonFetcher, {
    refreshInterval: 15_000,
  });

  const cards = [
    {
      label: "Active agents",
      value: data ? String(data.activeAgents) : "—",
      hint: data ? `${data.activelyRunning} running` : "loading…",
    },
    {
      label: "Open issues",
      value: data ? String(data.openIssues) : "—",
      hint: "failed runs (7d)",
    },
    {
      label: "Pending approvals",
      value: data ? String(data.pendingApprovals) : "—",
      hint: data ? `${data.pendingApprovals} awaiting` : "loading…",
    },
    {
      label: "Spend this month",
      value: data ? formatUsd(data.spendMonthUsd) : "—",
      hint: "across all agents",
    },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
      {cards.map((s) => (
        <Card
          key={s.label}
          className="border-border bg-card/50 backdrop-blur-sm"
        >
          <CardContent className="p-4">
            <div className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
              {s.label}
            </div>
            <div className="mt-2 font-serif text-2xl text-foreground">
              {s.value}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {s.hint}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

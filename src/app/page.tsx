import type { ReactNode } from "react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";

import { LineChart, Line } from "@/components/charts/line-chart";
import { AreaChart, Area } from "@/components/charts/area-chart";
import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip } from "@/components/charts/tooltip";

const stats = [
  { label: "Active agents", value: "—", hint: "0 running" },
  { label: "Open issues", value: "—", hint: "0 backlog" },
  { label: "Pending approvals", value: "—", hint: "0 awaiting" },
  { label: "Spend this month", value: "$0.00", hint: "across all agents" },
];

// Brand palette pulled from globals.css
const COLOR_PRIMARY = "#0cbf6a";
const COLOR_SECONDARY = "#34d399";
const COLOR_AMBER = "#fbbf24";
const COLOR_BLUE = "#60a5fa";
const COLOR_MUTED = "rgba(255,255,255,0.2)";
const COLOR_EXPENSE = "rgba(255,255,255,0.35)";

// ────────────────────────── Mock data ──────────────────────────

// 12 weeks of marketing top-of-funnel data
const marketingData = Array.from({ length: 12 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (11 - i) * 7);
  return {
    date: d.toISOString(),
    traffic: 4200 + Math.round(Math.sin(i / 2) * 900 + i * 220 + Math.random() * 300),
    leads: 180 + Math.round(Math.cos(i / 3) * 30 + i * 14 + Math.random() * 20),
  };
});

// Sales funnel — pipeline stages
const salesFunnelData = [
  { label: "Leads", value: 2840, displayValue: "2,840" },
  { label: "Qualified", value: 1120, displayValue: "1,120" },
  { label: "Proposal", value: 420, displayValue: "420" },
  { label: "Won", value: 148, displayValue: "148" },
];

// Fulfilment — orders by region, stacked by status
const fulfilmentData = [
  { region: "North", pending: 12, inProgress: 28, shipped: 45, delivered: 120 },
  { region: "South", pending: 18, inProgress: 22, shipped: 38, delivered: 96 },
  { region: "East", pending: 8, inProgress: 34, shipped: 52, delivered: 140 },
  { region: "West", pending: 14, inProgress: 19, shipped: 41, delivered: 108 },
];

// Finance — 12 months of revenue vs expenses
const financeData = Array.from({ length: 12 }, (_, i) => {
  const d = new Date();
  d.setMonth(d.getMonth() - (11 - i));
  const base = 48_000 + i * 4_200;
  return {
    date: d.toISOString(),
    revenue: base + Math.round(Math.sin(i / 2) * 6_000 + Math.random() * 3_500),
    expenses: Math.round(base * 0.62 + Math.cos(i / 3) * 4_000 + Math.random() * 2_500),
  };
});

// ────────────────────────── UI ──────────────────────────

function PillarCard({
  title,
  subtitle,
  kpi,
  children,
}: {
  title: string;
  subtitle: string;
  kpi?: { value: string; delta?: string; positive?: boolean };
  children: ReactNode;
}) {
  return (
    <Card className="border-border bg-card/50 backdrop-blur-sm transition-colors hover:border-primary/20">
      <CardContent className="p-5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[13px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
              {title}
            </h3>
            <p className="mt-1 text-[12px] text-muted-foreground/70">{subtitle}</p>
          </div>
          {kpi && (
            <div className="text-right">
              <div className="font-serif text-2xl leading-none text-foreground">
                {kpi.value}
              </div>
              {kpi.delta && (
                <div
                  className={
                    kpi.positive
                      ? "mt-1 text-[11px] font-medium text-primary"
                      : "mt-1 text-[11px] font-medium text-muted-foreground"
                  }
                >
                  {kpi.delta}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="-mx-1">{children}</div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <PageShell
      title="Dashboard"
      description="Your AI company at a glance — goals, agents, tickets, spend."
    >
      {/* Top summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
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

      {/* Core business pillars — 2x2 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Marketing — line chart, multi-series trend */}
        <PillarCard
          title="Marketing"
          subtitle="Traffic & leads — last 12 weeks"
          kpi={{ value: "8.4K", delta: "+12.3% vs prev", positive: true }}
        >
          <LineChart
            data={marketingData}
            xDataKey="date"
            aspectRatio="2.2 / 1"
            margin={{ top: 20, right: 20, bottom: 28, left: 36 }}
          >
            <Grid horizontal numTicksRows={4} />
            <Line dataKey="traffic" stroke={COLOR_PRIMARY} strokeWidth={2.5} />
            <Line dataKey="leads" stroke={COLOR_SECONDARY} strokeWidth={2} />
            <ChartTooltip />
          </LineChart>
        </PillarCard>

        {/* Sales — funnel chart */}
        <PillarCard
          title="Sales"
          subtitle="Pipeline by stage — current quarter"
          kpi={{ value: "5.2%", delta: "lead→won rate", positive: true }}
        >
          <FunnelChart
            data={salesFunnelData}
            orientation="horizontal"
            color={COLOR_PRIMARY}
            layers={3}
            showPercentage
            showValues
            showLabels
            edges="curved"
            className="mx-auto max-w-[420px]"
          />
        </PillarCard>

        {/* Fulfilment — horizontal stacked bars by region */}
        <PillarCard
          title="Fulfilment"
          subtitle="Orders by region & status"
          kpi={{ value: "847", delta: "orders this week", positive: true }}
        >
          <BarChart
            data={fulfilmentData}
            xDataKey="region"
            orientation="horizontal"
            stacked
            aspectRatio="2.2 / 1"
            margin={{ top: 20, right: 20, bottom: 28, left: 60 }}
          >
            <Grid horizontal={false} vertical numTicksColumns={5} />
            <Bar dataKey="delivered" fill={COLOR_PRIMARY} />
            <Bar dataKey="shipped" fill={COLOR_BLUE} />
            <Bar dataKey="inProgress" fill={COLOR_AMBER} />
            <Bar dataKey="pending" fill={COLOR_MUTED} />
            <ChartTooltip />
          </BarChart>
        </PillarCard>

        {/* Finance — stacked area, revenue vs expenses */}
        <PillarCard
          title="Finance"
          subtitle="Revenue vs expenses — trailing 12 months"
          kpi={{ value: "$38.2K", delta: "net profit / mo", positive: true }}
        >
          <AreaChart
            data={financeData}
            xDataKey="date"
            aspectRatio="2.2 / 1"
            margin={{ top: 20, right: 20, bottom: 28, left: 52 }}
          >
            <Grid horizontal numTicksRows={4} />
            <Area
              dataKey="revenue"
              fill={COLOR_PRIMARY}
              stroke={COLOR_PRIMARY}
              fillOpacity={0.35}
            />
            <Area
              dataKey="expenses"
              fill={COLOR_EXPENSE}
              stroke={COLOR_EXPENSE}
              fillOpacity={0.25}
            />
            <ChartTooltip />
          </AreaChart>
        </PillarCard>
      </div>
    </PageShell>
  );
}

"use client";

import type { ComponentType, CSSProperties, ReactNode } from "react";
import {
  ArrowDown,
  Bot,
  CalendarClock,
  Check,
  Code,
  Crown,
  Database,
  DollarSign,
  FileStack,
  KeyRound,
  Megaphone,
  Network,
  PhoneCall,
  ShieldCheck,
  Terminal,
  TrendingUp,
  Truck,
  Webhook,
  Zap,
} from "lucide-react";
import {
  SiAnthropic,
  SiClaude,
  SiFathom,
  SiGmail,
  SiHubspot,
  SiShopify,
  SiStripe,
  SiTelegram,
} from "react-icons/si";

import { cn } from "@/lib/utils";

// ────────────────────────── Shared primitives ──────────────────────────

function Stage({
  number,
  title,
  subtitle,
  children,
}: {
  number: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="relative">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 font-mono text-[12px] font-bold text-primary">
          {number}
        </span>
        <div>
          <h2 className="font-serif text-[1.6rem] font-normal leading-tight tracking-tight text-foreground">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card/40 p-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-primary/20 to-transparent" />
        {children}
      </div>
    </section>
  );
}

function Connector() {
  return (
    <div className="flex justify-center py-5">
      <div className="flex flex-col items-center gap-1">
        <div className="h-10 w-px bg-linear-to-b from-primary/60 to-primary/5" />
        <ArrowDown className="size-3.5 text-primary/50" />
      </div>
    </div>
  );
}

// ────────────────────────── Stage 1 — Departments ──────────────────────────

const DEPARTMENTS = [
  { id: "marketing", label: "Marketing", icon: Megaphone, selected: false },
  { id: "sales", label: "Sales", icon: TrendingUp, selected: true },
  { id: "fulfilment", label: "Fulfilment", icon: Truck, selected: false },
  { id: "finance", label: "Finance", icon: DollarSign, selected: true },
];

function DepartmentPicker() {
  return (
    <>
      <p className="mb-4 text-[12.5px] text-muted-foreground">
        The client picks the departments they want Rawgrowth to cover. In this
        example they only run <span className="text-foreground">Sales</span> and{" "}
        <span className="text-foreground">Finance</span> through us.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {DEPARTMENTS.map((d) => {
          const Icon = d.icon;
          return (
            <div
              key={d.id}
              className={cn(
                "relative rounded-xl border p-4 transition-colors",
                d.selected
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-card/30 opacity-50",
              )}
            >
              {d.selected && (
                <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary/20 text-primary">
                  <Check className="size-3" />
                </span>
              )}
              <div
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg border border-border",
                  d.selected
                    ? "bg-primary/15 text-primary"
                    : "bg-white/5 text-muted-foreground",
                )}
              >
                <Icon className="size-4" />
              </div>
              <div className="mt-3 text-[13px] font-semibold text-foreground">
                {d.label}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {d.selected ? "Selected" : "Skipped"}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ────────────────────────── Stage 2 — Integrations ──────────────────────────

type IntegrationNode = {
  name: string;
  Icon: ComponentType<{ className?: string; style?: CSSProperties }>;
  brand: string;
  methods: Array<"api_key" | "oauth" | "webhook">;
};

const methodMeta = {
  api_key: { label: "API Key", Icon: KeyRound },
  oauth: { label: "OAuth", Icon: ShieldCheck },
  webhook: { label: "Webhook", Icon: Webhook },
} as const;

const SALES_INTEGRATIONS: IntegrationNode[] = [
  { name: "HubSpot", Icon: SiHubspot, brand: "#FF7A59", methods: ["oauth"] },
  {
    name: "Fathom",
    Icon: SiFathom,
    brand: "#9F6EF3",
    methods: ["api_key", "webhook"],
  },
  { name: "Gmail", Icon: SiGmail, brand: "#EA4335", methods: ["oauth"] },
];

const FINANCE_INTEGRATIONS: IntegrationNode[] = [
  {
    name: "Stripe",
    Icon: SiStripe,
    brand: "#635BFF",
    methods: ["api_key", "webhook"],
  },
  {
    name: "Shopify",
    Icon: SiShopify,
    brand: "#95BF47",
    methods: ["api_key", "webhook"],
  },
];

function IntegrationsByDepartment() {
  return (
    <>
      <p className="mb-5 text-[12.5px] text-muted-foreground">
        For each selected department, the client connects the relevant tools —
        either by pasting an API key, granting OAuth permission, or pasting a
        webhook URL.
      </p>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <DeptColumn
          icon={TrendingUp}
          label="Sales"
          integrations={SALES_INTEGRATIONS}
        />
        <DeptColumn
          icon={DollarSign}
          label="Finance"
          integrations={FINANCE_INTEGRATIONS}
        />
      </div>
    </>
  );
}

function DeptColumn({
  icon: Icon,
  label,
  integrations,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  integrations: IntegrationNode[];
}) {
  return (
    <div className="rounded-xl border border-border bg-background/30 p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex size-6 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Icon className="size-3.5" />
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {integrations.map((i) => (
          <IntegrationCard key={i.name} integration={i} />
        ))}
      </div>
    </div>
  );
}

function IntegrationCard({ integration }: { integration: IntegrationNode }) {
  const { Icon, name, brand, methods } = integration;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-3">
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border"
        style={{ backgroundColor: `${brand}1a` }}
      >
        <Icon
          className="size-5"
          style={{ color: brand === "#FFFFFF" ? "#fff" : brand }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-foreground">
            {name}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <span className="size-1 rounded-full bg-primary shadow-[0_0_4px_rgba(12,191,106,.6)]" />
            Connected
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1">
          {methods.map((m) => {
            const MetaIcon = methodMeta[m].Icon;
            return (
              <span
                key={m}
                className="inline-flex items-center gap-1 rounded border border-border bg-background/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                <MetaIcon className="size-2.5" />
                {methodMeta[m].label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────── Stage 3 — Company LLM materialises ──────────────────────────

function LLMFormation() {
  const sources = [
    { name: "HubSpot", Icon: SiHubspot, brand: "#FF7A59" },
    { name: "Fathom", Icon: SiFathom, brand: "#9F6EF3" },
    { name: "Gmail", Icon: SiGmail, brand: "#EA4335" },
    { name: "Stripe", Icon: SiStripe, brand: "#635BFF" },
    { name: "Shopify", Icon: SiShopify, brand: "#95BF47" },
  ];
  return (
    <>
      <p className="mb-6 text-[12.5px] text-muted-foreground">
        As each integration syncs, its data is chunked and indexed into a
        per-tenant vector store. That store is the Company LLM — it updates
        live as the underlying tools change.
      </p>
      <div className="relative mx-auto max-w-2xl">
        {/* Top row: source logos */}
        <div className="flex items-center justify-between gap-3">
          {sources.map((s) => (
            <div key={s.name} className="flex flex-col items-center gap-1.5">
              <div
                className="flex size-11 items-center justify-center rounded-lg border border-border"
                style={{ backgroundColor: `${s.brand}1a` }}
              >
                <s.Icon
                  className="size-5"
                  style={{ color: s.brand === "#FFFFFF" ? "#fff" : s.brand }}
                />
              </div>
              <span className="text-[10.5px] text-muted-foreground">
                {s.name}
              </span>
            </div>
          ))}
        </div>

        {/* Flow lines */}
        <div
          aria-hidden="true"
          className="relative mt-4 h-16"
          style={{ overflow: "visible" }}
        >
          <svg
            viewBox="0 0 500 64"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
          >
            <defs>
              <linearGradient id="llm-flow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(12,191,106,0.4)" />
                <stop offset="100%" stopColor="rgba(12,191,106,0.05)" />
              </linearGradient>
            </defs>
            {/* Five curves from each source down to the central LLM */}
            {[50, 150, 250, 350, 450].map((x) => (
              <path
                key={x}
                d={`M ${x} 0 C ${x} 32, 250 32, 250 64`}
                stroke="url(#llm-flow)"
                strokeWidth="1.25"
                fill="none"
              />
            ))}
          </svg>
        </div>

        {/* Central LLM node */}
        <div className="relative mx-auto flex max-w-md items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4 shadow-[0_0_48px_rgba(12,191,106,.12)]">
          <div className="pointer-events-none absolute -inset-px rounded-xl bg-linear-to-r from-transparent via-primary/30 to-transparent opacity-60" />
          <div className="relative flex size-12 items-center justify-center rounded-lg bg-primary/20 text-primary">
            <Database className="size-6" />
          </div>
          <div className="relative min-w-0">
            <div className="text-[14px] font-semibold text-foreground">
              Company LLM
            </div>
            <div className="text-[11.5px] text-muted-foreground">
              Per-tenant RAG · 12,400 chunks indexed · 5 sources live
            </div>
          </div>
          <span className="relative ml-auto inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
            <span className="size-1.5 animate-pulse rounded-full bg-primary shadow-[0_0_6px_rgba(12,191,106,.6)]" />
            Live
          </span>
        </div>
      </div>
    </>
  );
}

// ────────────────────────── Stage 4 — Hire agents ──────────────────────────

type AgentNode = {
  id: string;
  name: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  role: string;
};

const ROOT: AgentNode = {
  id: "atlas",
  name: "Atlas",
  title: "Chief AI Officer",
  icon: Crown,
  role: "CEO",
};
const REPORTS: AgentNode[] = [
  { id: "mira", name: "Mira", title: "SDR", icon: PhoneCall, role: "Sales" },
  {
    id: "finn",
    name: "Finn",
    title: "Finance Ops",
    icon: Code,
    role: "Finance",
  },
];

function MiniOrgChart() {
  return (
    <>
      <p className="mb-5 text-[12.5px] text-muted-foreground">
        The client hires custom agents and assigns reporting lines. Each agent
        has its own role, runtime, and monthly budget — and queries the Company
        LLM by default.
      </p>
      <div className="flex flex-col items-center">
        <AgentMiniCard node={ROOT} />

        <div className="h-6 w-px bg-border" />

        <div className="flex items-start">
          {REPORTS.map((r, i) => {
            const isFirst = i === 0;
            const isLast = i === REPORTS.length - 1;
            return (
              <div
                key={r.id}
                className="flex flex-col items-center"
                style={{
                  paddingLeft: i === 0 ? 0 : 16,
                  paddingRight: isLast ? 0 : 16,
                }}
              >
                <div className="relative flex h-6 w-full justify-center">
                  <div
                    className={cn(
                      "absolute top-0 h-px bg-border",
                      isFirst && "left-1/2 right-0",
                      isLast && "left-0 right-1/2",
                    )}
                  />
                  <div className="w-px bg-border" />
                </div>
                <AgentMiniCard node={r} />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function AgentMiniCard({ node }: { node: AgentNode }) {
  const Icon = node.icon;
  return (
    <div className="flex w-52 items-center gap-2.5 rounded-lg border border-border bg-card/60 p-3">
      <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold text-foreground">
          {node.name}
        </div>
        <div className="truncate text-[10.5px] text-muted-foreground">
          {node.title}
        </div>
      </div>
      <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9.5px] text-muted-foreground">
        {node.role}
      </span>
    </div>
  );
}

// ────────────────────────── Stage 5 — Routines ──────────────────────────

type RoutineDemo = {
  title: string;
  triggerIcon: ComponentType<{ className?: string }>;
  trigger: string;
  agent: string;
  agentIcon: ComponentType<{ className?: string }>;
  summary: string;
};

const ROUTINE_DEMOS: RoutineDemo[] = [
  {
    title: "Post-call SOP generator",
    triggerIcon: Zap,
    trigger: "Fathom — Meeting ended",
    agent: "Atlas",
    agentIcon: Crown,
    summary:
      "Pull transcript → enrich with Drive context → draft SOP → email it to the account manager.",
  },
  {
    title: "Daily revenue digest",
    triggerIcon: CalendarClock,
    trigger: "Every weekday at 9:00 AM",
    agent: "Finn",
    agentIcon: Code,
    summary:
      "Summarise yesterday's Stripe + Shopify activity, flag anomalies, post to Slack #finance.",
  },
  {
    title: "New deal follow-up",
    triggerIcon: Zap,
    trigger: "HubSpot — Deal stage changed",
    agent: "Mira",
    agentIcon: PhoneCall,
    summary:
      "On stage change, pull relationship history and send a tailored next-step email from Gmail.",
  },
];

function RoutinesStrip() {
  return (
    <>
      <p className="mb-5 text-[12.5px] text-muted-foreground">
        Each agent gets routines — trigger + instructions. The agent decides
        how to execute using the tools it has access to.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {ROUTINE_DEMOS.map((r) => {
          const TriggerIcon = r.triggerIcon;
          const AgentIcon = r.agentIcon;
          return (
            <div
              key={r.title}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card/50 p-4"
            >
              <div className="flex items-center gap-2">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-primary/10 text-primary">
                  <TriggerIcon className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold text-foreground">
                    {r.title}
                  </div>
                  <div className="truncate text-[10.5px] text-muted-foreground">
                    {r.trigger}
                  </div>
                </div>
              </div>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                {r.summary}
              </p>
              <div className="flex items-center gap-2 border-t border-border pt-2">
                <div className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <AgentIcon className="size-3" />
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Runs as <span className="text-foreground">{r.agent}</span>
                </span>
                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  <span className="size-1 rounded-full bg-primary shadow-[0_0_4px_rgba(12,191,106,.6)]" />
                  Active
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ────────────────────────── Stage 6 — External access via MCP ──────────────────────────

type ExternalClient = {
  name: string;
  Icon: ComponentType<{ className?: string; style?: CSSProperties }>;
  brand?: string;
  note: string;
};

const EXTERNAL_CLIENTS: ExternalClient[] = [
  {
    name: "Claude Desktop",
    Icon: SiClaude,
    brand: "#D97757",
    note: "Native MCP support",
  },
  {
    name: "Cursor",
    Icon: Terminal,
    note: "IDE via MCP config",
  },
  {
    name: "Telegram bot",
    Icon: SiTelegram,
    brand: "#26A5E4",
    note: "Thin wrapper over MCP",
  },
  {
    name: "Custom client",
    Icon: SiAnthropic,
    brand: "#D97757",
    note: "SDK / HTTP call",
  },
];

function ExternalAccess() {
  return (
    <>
      <p className="mb-6 text-[12.5px] text-muted-foreground">
        The Company LLM isn&apos;t locked inside Rawgrowth. Each client gets a
        private MCP server URL — paste it into any MCP-compatible tool and
        query the company&apos;s full data graph from wherever they already
        work.
      </p>

      <div className="relative mx-auto max-w-2xl">
        {/* Clients row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {EXTERNAL_CLIENTS.map((c) => {
            const iconColor =
              c.brand && c.brand !== "#FFFFFF" ? c.brand : "#fff";
            return (
              <div
                key={c.name}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card/40 p-4"
              >
                <div
                  className="flex size-10 items-center justify-center rounded-lg border border-border"
                  style={{
                    backgroundColor: c.brand ? `${c.brand}1a` : "rgba(255,255,255,0.05)",
                  }}
                >
                  <c.Icon
                    className="size-5"
                    style={{ color: c.brand ? iconColor : undefined }}
                  />
                </div>
                <div className="text-[12px] font-semibold text-foreground">
                  {c.name}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {c.note}
                </div>
              </div>
            );
          })}
        </div>

        {/* Flow lines into MCP pill */}
        <div aria-hidden="true" className="relative mt-3 h-10">
          <svg
            viewBox="0 0 400 40"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
          >
            <defs>
              <linearGradient id="mcp-flow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(12,191,106,0.4)" />
                <stop offset="100%" stopColor="rgba(12,191,106,0.1)" />
              </linearGradient>
            </defs>
            {[50, 150, 250, 350].map((x) => (
              <path
                key={x}
                d={`M ${x} 0 C ${x} 20, 200 20, 200 40`}
                stroke="url(#mcp-flow)"
                strokeWidth="1.25"
                fill="none"
                strokeDasharray="3 3"
              />
            ))}
          </svg>
        </div>

        {/* MCP server pill */}
        <div className="mx-auto flex max-w-md items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 p-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/20 text-primary">
            <Network className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-foreground">
              Your company MCP server
            </div>
            <div className="truncate font-mono text-[10.5px] text-muted-foreground">
              mcp://acme.aios.rawgrowth.ai/llm
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
            <span className="size-1.5 animate-pulse rounded-full bg-primary shadow-[0_0_6px_rgba(12,191,106,.6)]" />
            Online
          </span>
        </div>

        {/* Line to Company LLM */}
        <div className="flex justify-center py-3">
          <div className="flex flex-col items-center gap-1">
            <div className="h-6 w-px bg-linear-to-b from-primary/50 to-primary/10" />
            <ArrowDown className="size-3.5 text-primary/50" />
          </div>
        </div>

        {/* Company LLM pill */}
        <div className="mx-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-background/50 p-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Database className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-foreground">
              Company LLM
            </div>
            <div className="text-[10.5px] text-muted-foreground">
              Per-tenant vector store · same source of truth as in-app agents
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ────────────────────────── Header / closer ──────────────────────────

function FlowHeader() {
  return (
    <div className="mb-8 rounded-2xl border border-border bg-card/30 p-6">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <FileStack className="size-5" />
        </div>
        <div>
          <h2 className="font-serif text-xl font-normal leading-tight tracking-tight text-foreground">
            What a client&apos;s first 30 days look like
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
            Six stages from signing up to a live AI OS — and from there, the
            ability to query their company from Claude Desktop, Cursor, or a
            Telegram bot. The example below follows a client focused on Sales
            and Finance.
          </p>
        </div>
      </div>
    </div>
  );
}

function FlowFooter() {
  return (
    <div className="mt-10 flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
        <Bot className="size-4" />
      </div>
      <div className="text-[12.5px] leading-relaxed text-muted-foreground">
        <span className="text-foreground">The feedback loop.</span> Every agent
        run, routine execution, and external query adds context back into the
        Company LLM — decisions logged, transcripts indexed, outcomes tagged.
        The longer a client runs on Rawgrowth, the better their LLM gets.
      </div>
    </div>
  );
}

// ────────────────────────── Top-level ──────────────────────────

export function BlueprintFlow() {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(12,191,106,.06),transparent_60%)]"
      />

      <FlowHeader />

      <Stage
        number={1}
        title="Onboarding"
        subtitle="Client tells us which departments they want Rawgrowth to cover."
      >
        <DepartmentPicker />
      </Stage>

      <Connector />

      <Stage
        number={2}
        title="Connect integrations"
        subtitle="Per department, the client connects the relevant tools via API key or OAuth."
      >
        <IntegrationsByDepartment />
      </Stage>

      <Connector />

      <Stage
        number={3}
        title="Company LLM materialises"
        subtitle="Integration data streams into a per-tenant vector store — the client's private LLM."
      >
        <LLMFormation />
      </Stage>

      <Connector />

      <Stage
        number={4}
        title="Hire agents"
        subtitle="Custom AI employees with roles, reporting lines, and monthly budgets."
      >
        <MiniOrgChart />
      </Stage>

      <Connector />

      <Stage
        number={5}
        title="Create & schedule routines"
        subtitle="Each agent owns repeatable workflows — trigger + instructions. Schedules, webhooks, integration events."
      >
        <RoutinesStrip />
      </Stage>

      <Connector />

      <Stage
        number={6}
        title="Query the Company LLM from anywhere"
        subtitle="A private MCP server URL per client — the LLM is accessible from any compatible tool."
      >
        <ExternalAccess />
      </Stage>

      <FlowFooter />
    </div>
  );
}

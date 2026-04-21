"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Megaphone,
  BadgeDollarSign,
  PackageCheck,
  Wallet,
  UserRound,
  HelpCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { jsonFetcher } from "@/lib/swr";
import { useAgents } from "@/lib/agents/use-agents";
import type { Agent, Department } from "@/lib/agents/dto";
import { DEPARTMENTS } from "@/lib/agents/dto";

type OrgRes = {
  pillars: {
    marketing: boolean;
    sales: boolean;
    fulfilment: boolean;
    finance: boolean;
  };
};

const META: Record<
  Department,
  {
    label: string;
    icon: React.ComponentType<{
      className?: string;
      style?: React.CSSProperties;
    }>;
    brand: string;
  }
> = {
  marketing: { label: "Marketing", icon: Megaphone, brand: "#60a5fa" },
  sales: { label: "Sales", icon: BadgeDollarSign, brand: "#0cbf6a" },
  fulfilment: { label: "Fulfilment", icon: PackageCheck, brand: "#fbbf24" },
  finance: { label: "Finance", icon: Wallet, brand: "#a78bfa" },
};

export function DepartmentsView() {
  const { agents, updateAgent } = useAgents();
  const { data: orgData } = useSWR<OrgRes>("/api/org/me", jsonFetcher);

  const grouped = useMemo(() => {
    const buckets: Record<Department | "unassigned", Agent[]> = {
      marketing: [],
      sales: [],
      fulfilment: [],
      finance: [],
      unassigned: [],
    };
    for (const a of agents) {
      const key = (a.department ?? "unassigned") as Department | "unassigned";
      buckets[key].push(a);
    }
    return buckets;
  }, [agents]);

  async function reassign(agent: Agent, dept: Department | null) {
    try {
      await updateAgent(agent.id, { department: dept });
      toast.success(
        dept
          ? `Moved ${agent.name} to ${META[dept].label}`
          : `Unassigned ${agent.name}`,
      );
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const pillars = orgData?.pillars;

  return (
    <div className="space-y-8">
      {grouped.unassigned.length > 0 && (
        <UnassignedSection
          agents={grouped.unassigned}
          onReassign={reassign}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {DEPARTMENTS.map((d) => (
          <DepartmentCard
            key={d}
            department={d}
            agents={grouped[d]}
            onReassign={reassign}
            pillarEnabled={pillars ? pillars[d] : true}
          />
        ))}
      </div>
    </div>
  );
}

function DepartmentCard({
  department,
  agents,
  onReassign,
  pillarEnabled,
}: {
  department: Department;
  agents: Agent[];
  onReassign: (agent: Agent, dept: Department | null) => void;
  pillarEnabled: boolean;
}) {
  const meta = META[department];
  const Icon = meta.icon;

  return (
    <Card className="border-border bg-card/40">
      <CardContent className="p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="flex size-10 items-center justify-center rounded-lg border border-border"
              style={{ backgroundColor: `${meta.brand}1a` }}
            >
              <Icon className="size-5" style={{ color: meta.brand }} />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-foreground">
                {meta.label}
              </h3>
              <div className="text-[11.5px] text-muted-foreground">
                {agents.length} agent{agents.length === 1 ? "" : "s"}
                {!pillarEnabled && (
                  <span className="ml-2 text-amber-400">
                    · pillar is off — chart hidden on Dashboard
                  </span>
                )}
              </div>
            </div>
          </div>
          {agents.length > 0 && (
            <Badge
              variant="secondary"
              className="bg-white/5 text-[10px] text-muted-foreground"
            >
              {agents.length}
            </Badge>
          )}
        </div>

        {agents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-background/40 py-6 text-center text-[12px] text-muted-foreground">
            No agents in this department yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {agents.map((a) => (
              <AgentRow
                key={a.id}
                agent={a}
                onReassign={onReassign}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function UnassignedSection({
  agents,
  onReassign,
}: {
  agents: Agent[];
  onReassign: (agent: Agent, dept: Department | null) => void;
}) {
  return (
    <Card className="border-border border-dashed bg-card/30">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
            <HelpCircle className="size-5" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-foreground">
              Unassigned
            </h3>
            <div className="text-[11.5px] text-muted-foreground">
              {agents.length} agent{agents.length === 1 ? "" : "s"} waiting to be
              placed in a department
            </div>
          </div>
        </div>
        <ul className="space-y-2">
          {agents.map((a) => (
            <AgentRow key={a.id} agent={a} onReassign={onReassign} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AgentRow({
  agent,
  onReassign,
}: {
  agent: Agent;
  onReassign: (agent: Agent, dept: Department | null) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/40 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-primary/10 text-primary">
          <UserRound className="size-3.5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-foreground">
            {agent.name}
          </div>
          {agent.title && (
            <div className="truncate text-[11px] text-muted-foreground">
              {agent.title}
            </div>
          )}
        </div>
      </div>
      <Select
        value={agent.department ?? "__none__"}
        onValueChange={(v) => onReassign(agent, v === "__none__" ? null : (v as Department))}
      >
        <SelectTrigger className="h-8 w-36 bg-input/40 text-[12px]">
          <SelectValue placeholder="Move to…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Unassigned</SelectItem>
          <SelectItem value="marketing">Marketing</SelectItem>
          <SelectItem value="sales">Sales</SelectItem>
          <SelectItem value="fulfilment">Fulfilment</SelectItem>
          <SelectItem value="finance">Finance</SelectItem>
        </SelectContent>
      </Select>
    </li>
  );
}

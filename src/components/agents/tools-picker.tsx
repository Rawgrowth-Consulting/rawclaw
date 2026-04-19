"use client";

import Link from "next/link";
import useSWR from "swr";
import { Plug, Plus } from "lucide-react";

import { jsonFetcher } from "@/lib/swr";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ToolEntry = {
  name: string;
  description: string;
  isWrite: boolean;
};
type IntegrationGroup = {
  id: string;
  name: string;
  connected: boolean;
  tools: ToolEntry[];
};
type CatalogResponse = {
  integrations: IntegrationGroup[];
  workspace: ToolEntry[];
};

export type WritePolicy = Record<
  string,
  "direct" | "requires_approval" | "draft_only"
>;

const POLICY_OPTIONS: Array<{
  value: "direct" | "requires_approval" | "draft_only";
  label: string;
}> = [
  { value: "direct", label: "Direct" },
  { value: "requires_approval", label: "Requires approval" },
  { value: "draft_only", label: "Draft only" },
];

export function ToolsPicker({
  value,
  onChange,
}: {
  value: WritePolicy;
  onChange: (v: WritePolicy) => void;
}) {
  const { data, isLoading } = useSWR<CatalogResponse>(
    "/api/agents/tool-catalog",
    jsonFetcher,
  );

  function toggleTool(toolName: string, isWrite: boolean) {
    const next: WritePolicy = { ...value };
    if (toolName in next) {
      delete next[toolName];
    } else {
      next[toolName] = isWrite ? "requires_approval" : "direct";
    }
    onChange(next);
  }

  function setPolicy(
    toolName: string,
    policy: "direct" | "requires_approval" | "draft_only",
  ) {
    onChange({ ...value, [toolName]: policy });
  }

  if (isLoading && !data) {
    return (
      <div className="text-[12px] text-muted-foreground">Loading tools…</div>
    );
  }

  const integrations = data?.integrations ?? [];
  const workspace = data?.workspace ?? [];

  return (
    <div className="space-y-4">
      {workspace.length > 0 && (
        <GroupBlock title="Workspace" connected>
          {workspace.map((t) => (
            <ToolRow
              key={t.name}
              tool={t}
              enabled={t.name in value}
              policy={value[t.name] ?? "direct"}
              onToggle={() => toggleTool(t.name, t.isWrite)}
              onPolicyChange={(p) => setPolicy(t.name, p)}
            />
          ))}
        </GroupBlock>
      )}

      {integrations.map((g) => (
        <GroupBlock key={g.id} title={g.name} connected={g.connected}>
          {g.tools.map((t) => (
            <ToolRow
              key={t.name}
              tool={t}
              enabled={t.name in value}
              policy={value[t.name] ?? "direct"}
              disabled={!g.connected}
              onToggle={() => toggleTool(t.name, t.isWrite)}
              onPolicyChange={(p) => setPolicy(t.name, p)}
            />
          ))}
        </GroupBlock>
      ))}

      <Link
        href="/integrations"
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-card/30 px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Plus className="size-3.5" />
        Add more integrations
      </Link>
    </div>
  );
}

function GroupBlock({
  title,
  connected,
  children,
}: {
  title: string;
  connected: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-card/30">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Plug className="size-3.5 text-muted-foreground" />
          <span className="text-[12px] font-medium text-foreground">
            {title}
          </span>
        </div>
        <span
          className={
            connected
              ? "rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.5px] text-primary"
              : "rounded-full border border-border bg-muted/30 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.5px] text-muted-foreground"
          }
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

function ToolRow({
  tool,
  enabled,
  policy,
  disabled,
  onToggle,
  onPolicyChange,
}: {
  tool: ToolEntry;
  enabled: boolean;
  policy: "direct" | "requires_approval" | "draft_only";
  disabled?: boolean;
  onToggle: () => void;
  onPolicyChange: (p: "direct" | "requires_approval" | "draft_only") => void;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <input
        type="checkbox"
        checked={enabled}
        disabled={disabled}
        onChange={onToggle}
        className="mt-0.5 size-3.5 accent-primary disabled:opacity-40"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <code className="text-[11.5px] text-foreground">{tool.name}</code>
          {tool.isWrite && (
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.5px] text-amber-400">
              Write
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {tool.description}
        </p>
      </div>
      {enabled && tool.isWrite && (
        <Select
          value={policy}
          onValueChange={(v) =>
            onPolicyChange(
              (v ?? "direct") as "direct" | "requires_approval" | "draft_only",
            )
          }
        >
          <SelectTrigger className="h-7 w-[160px] bg-input/40 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {POLICY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

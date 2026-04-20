"use client";

import { CONNECTORS } from "@/lib/connectors";
import type { WritePolicy } from "@/components/agents/tools-picker";

/**
 * Connector picker shown in self-hosted mode. Purely informational —
 * storing a connector here doesn't grant OAuth or mint tokens. It tells
 * the operator which tools the agent is expected to use, and renders
 * logos on the agent card so the org chart reads at a glance.
 *
 * The actual auth + tool calls happen in the client's Claude Code via
 * Anthropic's native connectors (or community MCP servers for the rest).
 */
export function ConnectorsPicker({
  value,
  onChange,
}: {
  value: WritePolicy;
  onChange: (v: WritePolicy) => void;
}) {
  function toggle(id: string) {
    const next: WritePolicy = { ...value };
    if (id in next) delete next[id];
    else next[id] = "direct";
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Pick the tools this agent uses. These show as logos on the agent
        card. Auth happens in your Claude Desktop/Code connector settings —
        not here.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {CONNECTORS.map((c) => {
          const enabled = c.id in value;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className={
                enabled
                  ? "flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-left text-[12px] font-medium text-foreground"
                  : "flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-2 text-left text-[12px] font-medium text-muted-foreground hover:border-primary/30 hover:text-foreground"
              }
            >
              <div
                className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border"
                style={{ backgroundColor: `${c.brand}1a` }}
              >
                <c.Icon
                  className="size-3.5"
                  style={{ color: c.brand === "#FFFFFF" ? "#fff" : c.brand }}
                />
              </div>
              <span className="truncate">{c.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { MessageSquare, Plus, UserRound } from "lucide-react";
import { useSWRConfig } from "swr";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAgents } from "@/lib/agents/use-agents";
import type { Agent } from "@/lib/agents/dto";
import { AddSubAgentModal } from "@/components/agents/AddSubAgentModal";

/**
 * Per-department agent list. Filters the global agents store down to the
 * dept slug and renders each agent as a row with two actions:
 *   - "Open chat" - links to the agent panel (chat tab lands in §1).
 *   - "+ sub-agent" - opens the same AddSubAgentModal the /agents/tree page
 *     uses so behaviour stays consistent across surfaces.
 *
 * The store is a single SWR cache key, so the list refreshes automatically
 * after a sub-agent gets created.
 */
export function DepartmentAgentList({ slug }: { slug: string }) {
  const { agents, hasHydrated } = useAgents();
  const { mutate } = useSWRConfig();
  const deptAgents = agents.filter((a) => a.department === slug);

  const [parent, setParent] = useState<Agent | null>(null);

  if (!hasHydrated) {
    return (
      <div className="h-32 animate-pulse rounded-2xl border border-border bg-card/20" />
    );
  }

  if (deptAgents.length === 0) {
    return (
      <Card className="border-border border-dashed bg-card/30">
        <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
          <div className="text-[13px] font-semibold text-foreground">
            No agents in this department yet
          </div>
          <p className="max-w-sm text-[12px] text-muted-foreground">
            Hire one from the Agents page or move an existing agent into this
            department from /departments.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-border bg-card/40">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
              Agents
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {deptAgents.length} total
            </span>
          </div>
          <ul className="space-y-2">
            {deptAgents.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/40 px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-primary/10 text-primary">
                    <UserRound className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {a.name}
                      </span>
                      {a.isDepartmentHead && (
                        <Badge
                          variant="secondary"
                          className="bg-amber-400/15 text-[9px] text-amber-300"
                        >
                          Head
                        </Badge>
                      )}
                    </div>
                    {a.title && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {a.title}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/agents/${a.id}`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card/60 px-2.5 text-[12px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10"
                  >
                    <MessageSquare className="size-3.5" />
                    Open chat
                  </Link>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 text-[12px]"
                    onClick={() => setParent(a)}
                  >
                    <Plus className="size-3.5" />
                    Sub-agent
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {parent && (
        <AddSubAgentModal
          parentId={parent.id}
          parentName={parent.name}
          parentDepartment={parent.department ?? null}
          onClose={() => setParent(null)}
          onCreated={() => {
            // Revalidate the agents list so the new sub-agent shows up
            // immediately in this dept view + the org chart above.
            void mutate("/api/agents");
            setParent(null);
          }}
        />
      )}
    </>
  );
}

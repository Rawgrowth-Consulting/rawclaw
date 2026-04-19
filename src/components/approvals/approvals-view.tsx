"use client";

import { useState } from "react";
import useSWR from "swr";
import { ShieldCheck, Check, X, Bot, Repeat } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { jsonFetcher } from "@/lib/swr";

type Approval = {
  id: string;
  organization_id: string;
  routine_run_id: string | null;
  agent_id: string | null;
  tool_name: string;
  tool_args: Record<string, unknown>;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  agent_name: string | null;
  routine_title: string | null;
};

type ListResponse = { approvals: Approval[] };

const TABS: Array<{ key: "pending" | "approved" | "rejected"; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

export function ApprovalsView() {
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, mutate, isLoading } = useSWR<ListResponse>(
    `/api/approvals?status=${tab}`,
    jsonFetcher,
    { refreshInterval: 10_000 },
  );

  async function decide(id: string, decision: "approved" | "rejected") {
    setDeciding(id);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await mutate();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeciding(null);
    }
  }

  const approvals = data?.approvals ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              tab === t.key
                ? "border-b-2 border-primary px-3 py-2 text-[13px] font-medium text-foreground"
                : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {error}
        </div>
      )}

      {isLoading && !data ? (
        <div className="text-[12px] text-muted-foreground">Loading…</div>
      ) : approvals.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={
            tab === "pending"
              ? "Nothing to approve"
              : `No ${tab} approvals`
          }
          description={
            tab === "pending"
              ? "When an agent attempts an action gated by its write policy, the request will land here for you to approve or reject."
              : `You haven't ${tab} any approvals yet.`
          }
        />
      ) : (
        <div className="space-y-3">
          {approvals.map((a) => (
            <Card key={a.id} className="border-border bg-card/50">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {a.agent_name && (
                        <span className="inline-flex items-center gap-1">
                          <Bot className="size-3" />
                          {a.agent_name}
                        </span>
                      )}
                      {a.routine_title && (
                        <span className="inline-flex items-center gap-1">
                          <Repeat className="size-3" />
                          {a.routine_title}
                        </span>
                      )}
                      <span>·</span>
                      <span>{relativeTime(a.created_at)}</span>
                    </div>

                    <div>
                      <div className="font-mono text-[12px] text-foreground">
                        {a.tool_name}
                      </div>
                      {a.reason && (
                        <div className="mt-0.5 text-[12px] text-muted-foreground">
                          {a.reason}
                        </div>
                      )}
                    </div>

                    <details className="group">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                        View arguments
                      </summary>
                      <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-background/60 p-2 text-[11px] leading-relaxed text-foreground">
                        {JSON.stringify(a.tool_args, null, 2)}
                      </pre>
                    </details>
                  </div>

                  {a.status === "pending" ? (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={deciding === a.id}
                        onClick={() => decide(a.id, "rejected")}
                      >
                        <X className="size-3.5" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        disabled={deciding === a.id}
                        onClick={() => decide(a.id, "approved")}
                      >
                        <Check className="size-3.5" />
                        Approve
                      </Button>
                    </div>
                  ) : (
                    <div
                      className={
                        a.status === "approved"
                          ? "shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.5px] text-primary"
                          : "shrink-0 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.5px] text-muted-foreground"
                      }
                    >
                      {a.status}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

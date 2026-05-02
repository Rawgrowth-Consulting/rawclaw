"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { useState } from "react";
import { jsonFetcher } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ArrowLeft,
  RefreshCw,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
} from "lucide-react";

type Run = {
  id: string;
  status: string;
  source: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  output: string | null;
  error: string | null;
};
type Resp = {
  routine: {
    id: string;
    title: string | null;
    description: string | null;
    status: string | null;
    created_at: string | null;
    assignee_agent_id: string | null;
  };
  assignee: {
    id: string;
    name: string;
    role: string | null;
    department: string | null;
  } | null;
  runs: Run[];
};

const STATUS_ICON: Record<
  string,
  { Icon: typeof CheckCircle2; tone: string }
> = {
  succeeded: { Icon: CheckCircle2, tone: "text-[#aad08f]" },
  failed: { Icon: XCircle, tone: "text-[#f4b27a]" },
  running: { Icon: Loader2, tone: "text-primary animate-spin" },
  pending: { Icon: Clock, tone: "text-amber-300" },
};

function fmtDur(start: string | null, end: string | null): string {
  if (!start) return "-";
  const s = Date.parse(start);
  const e = end ? Date.parse(end) : Date.now();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function TaskDetailClient({ routineId }: { routineId: string }) {
  const router = useRouter();
  const { data, mutate, isLoading } = useSWR<Resp>(
    `/api/tasks/${routineId}`,
    jsonFetcher,
    { refreshInterval: 5_000, revalidateOnFocus: true },
  );
  const [rerunning, setRerunning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <div className="h-12 animate-pulse rounded-md bg-card/40" />
        <div className="h-32 animate-pulse rounded-md bg-card/40" />
      </div>
    );
  }

  async function rerun() {
    setRerunning(true);
    try {
      const res = await fetch(`/api/tasks/${routineId}`, { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "rerun failed");
      toast.success("Re-running");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRerunning(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete this task + all its runs?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/tasks/${routineId}`, { method: "DELETE" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "delete failed");
      toast.success("Deleted");
      router.push("/tasks");
    } catch (err) {
      toast.error((err as Error).message);
      setDeleting(false);
    }
  }

  const { routine, assignee, runs } = data;
  const latest = runs[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          All tasks
        </Link>
        <div className="flex items-center gap-2">
          {assignee && (
            <Button
              size="sm"
              variant="secondary"
              onClick={rerun}
              disabled={rerunning}
            >
              <RefreshCw
                className={"mr-1.5 size-3.5 " + (rerunning ? "animate-spin" : "")}
              />
              {rerunning ? "Re-running..." : "Re-run"}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={remove}
            disabled={deleting}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card/40 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {latest && (() => {
            const meta = STATUS_ICON[latest.status] ?? STATUS_ICON.pending;
            const Icon = meta.Icon;
            return (
              <span
                className={
                  "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] uppercase tracking-widest " +
                  meta.tone
                }
              >
                <Icon className="size-3" strokeWidth={2} />
                {latest.status}
              </span>
            );
          })()}
          <h2 className="text-[18px] font-medium tracking-tight text-foreground">
            {routine.title}
          </h2>
        </div>
        {assignee && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Assigned to{" "}
            <Link
              href={`/agents/${assignee.id}`}
              className="text-primary hover:underline"
            >
              {assignee.name}
            </Link>
            {assignee.role && (
              <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                ({assignee.role})
              </span>
            )}
          </p>
        )}
        {routine.description && (
          <div className="mt-4">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Brief
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
              {routine.description}
            </p>
          </div>
        )}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[12px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
            Runs
          </h3>
          <span className="text-[11px] text-muted-foreground">
            {runs.length} total · auto-refresh 5s
          </span>
        </div>
        {runs.length === 0 && (
          <p className="text-[12px] text-muted-foreground">No runs yet.</p>
        )}
        <div className="space-y-3">
          {runs.map((r, i) => {
            const meta = STATUS_ICON[r.status] ?? STATUS_ICON.pending;
            const Icon = meta.Icon;
            return (
              <div
                key={r.id}
                className="rounded-md border border-border bg-card/40 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] uppercase tracking-widest " +
                        meta.tone
                      }
                    >
                      <Icon className="size-3" strokeWidth={2} />
                      {r.status}
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      run #{runs.length - i}
                    </span>
                    {r.source && (
                      <span className="rounded-full bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {r.source}
                      </span>
                    )}
                  </div>
                  <div className="text-right text-[10px] text-muted-foreground">
                    <div>started {new Date(r.createdAt).toLocaleString()}</div>
                    <div className="mt-0.5 font-mono">
                      {fmtDur(r.startedAt ?? r.createdAt, r.completedAt)}
                    </div>
                  </div>
                </div>
                {r.error && (
                  <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                    {r.error}
                  </div>
                )}
                {r.output && (
                  <div className="mt-3">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-primary">
                      Output
                    </p>
                    <pre className="mt-2 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-[12px] leading-relaxed text-foreground">
                      {r.output}
                    </pre>
                  </div>
                )}
                {!r.output && !r.error && r.status !== "pending" && r.status !== "running" && (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    No output recorded.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

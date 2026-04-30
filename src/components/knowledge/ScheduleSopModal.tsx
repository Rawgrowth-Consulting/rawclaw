"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * ScheduleSopModal (P1 #11)
 *
 * Operator opens a knowledge file → clicks Schedule → this modal POSTs
 * GET /api/sops/[id]/schedule/preview to get an LLM-extracted preview
 * (cron + timezone + agent + action summary). Each field is editable so
 * the operator can override before clicking Save. Save POSTs to
 * /api/sops/[id]/schedule which persists the routine + schedule trigger.
 *
 * Design notes:
 *  - Brand tokens (--brand-surface, --line, --text-strong) so it sits
 *    inside the dark portal aesthetic.
 *  - data-onboarding="sop-scheduler" on the root for e2e selector.
 *  - No em-dashes; no banned words.
 *  - The agent dropdown is populated lazily from /api/agents so the
 *    operator can swap to anyone in the org instead of just the
 *    LLM-picked default.
 */

export type ScheduleSopModalProps = {
  knowledgeFileId: string;
  fileName: string;
  isOpen: boolean;
  onClose: () => void;
};

type PreviewResponse = {
  ok: boolean;
  knowledgeFileId: string;
  fileName: string;
  cron: string;
  timezone: string;
  agentRole: string;
  actionSummary: string;
  agent: {
    id: string;
    name: string;
    title: string | null;
    department: string | null;
    isDepartmentHead: boolean | null;
  };
};

type AgentOption = {
  id: string;
  name: string;
  title: string | null;
  department: string | null;
};

export function ScheduleSopModal({
  knowledgeFileId,
  fileName,
  isOpen,
  onClose,
}: ScheduleSopModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cron, setCron] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [actionSummary, setActionSummary] = useState("");
  const [agentId, setAgentId] = useState<string>("");
  const [agentRole, setAgentRole] = useState<string>("");
  const [agents, setAgents] = useState<AgentOption[]>([]);

  // Reset + (re)fetch preview each time the modal opens for a fresh file.
  // The synchronous setState block resets the form before the async fetch
  // returns; React 19 strict-hooks flags it but it's intentional - the
  // alternative (key-prop remount) would lose the open animation.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect -- intentional reset on open; remount alternative breaks sheet animation */
    setLoading(true);
    setError(null);
    setCron("");
    setTimezone("UTC");
    setActionSummary("");
    setAgentId("");
    /* eslint-enable react-hooks/set-state-in-effect */

    const previewUrl = `/api/sops/${knowledgeFileId}/schedule/preview`;
    Promise.all([
      fetch(previewUrl).then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? "Preview failed");
        }
        return (await r.json()) as PreviewResponse;
      }),
      fetch("/api/agents")
        .then((r) => (r.ok ? r.json() : { agents: [] }))
        .catch(() => ({ agents: [] })),
    ])
      .then(([preview, agentsBody]) => {
        if (cancelled) return;
        setCron(preview.cron);
        setTimezone(preview.timezone);
        setActionSummary(preview.actionSummary);
        setAgentId(preview.agent.id);
        setAgentRole(preview.agentRole);
        const list = (
          (agentsBody as { agents?: AgentOption[] }).agents ?? []
        ).map((a) => ({
          id: a.id,
          name: a.name,
          title: a.title,
          department: a.department,
        }));
        setAgents(list);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, knowledgeFileId]);

  if (!isOpen) return null;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sops/${knowledgeFileId}/schedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cron: cron.trim(),
          timezone: timezone.trim(),
          actionSummary: actionSummary.trim(),
          agentId: agentId || undefined,
        }),
      });
      const json = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Schedule failed");
      }
      toast.success(`Scheduled "${actionSummary}" on ${cron}`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const cronValid = cron.trim().split(/\s+/).length === 5;

  return (
    <div
      data-onboarding="sop-scheduler"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="relative w-full max-w-lg rounded-lg border border-[var(--line)] bg-[var(--brand-surface)] p-6 text-[var(--text-body)]">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-[var(--text-muted)] hover:text-[var(--text-strong)]"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2 text-[var(--text-strong)]">
          <CalendarClock className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-medium">Schedule SOP as routine</h2>
        </div>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {fileName}
        </p>

        {loading ? (
          <div className="mt-8 flex items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading SOP and proposing a schedule...
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="mb-1 block text-[12px] font-medium text-[var(--text-strong)]">
                  Action summary
                </Label>
                <Input
                  value={actionSummary}
                  onChange={(e) => setActionSummary(e.target.value)}
                  placeholder="Pull yesterday MRR from Stripe"
                  className="bg-input/40 text-[13px]"
                />
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  5 to 10 word imperative. Becomes the routine title.
                </p>
              </div>

              <div>
                <Label className="mb-1 block text-[12px] font-medium text-[var(--text-strong)]">
                  Cron
                </Label>
                <Input
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="0 9 * * 1-5"
                  className="bg-input/40 font-mono text-[13px]"
                />
                {!cronValid && cron.trim().length > 0 && (
                  <p className="mt-1 text-[11px] text-destructive">
                    Cron must have 5 fields.
                  </p>
                )}
              </div>

              <div>
                <Label className="mb-1 block text-[12px] font-medium text-[var(--text-strong)]">
                  Timezone
                </Label>
                <Input
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="UTC"
                  className="bg-input/40 text-[13px]"
                />
              </div>

              <div className="sm:col-span-2">
                <Label className="mb-1 block text-[12px] font-medium text-[var(--text-strong)]">
                  Assignee agent
                </Label>
                <select
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-2 py-2 text-[13px] text-[var(--text-strong)] transition-colors hover:border-primary/30 focus:border-primary/50 focus:outline-none"
                >
                  {agents.length === 0 && (
                    <option value="">(no agents)</option>
                  )}
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.title ? ` - ${a.title}` : ""}
                      {a.department ? ` (${a.department})` : ""}
                    </option>
                  ))}
                </select>
                {agentRole && (
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                    LLM picked role keyword: {agentRole}
                  </p>
                )}
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                {error}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button onClick={onClose} variant="ghost" disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={
                  saving ||
                  !cronValid ||
                  !actionSummary.trim() ||
                  !agentId
                }
                className="bg-primary text-white hover:bg-primary/90"
              >
                {saving ? "Scheduling..." : "Schedule routine"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

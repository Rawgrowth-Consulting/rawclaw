"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

type SubAgent = { name: string; title: string };

/**
 * Client form for "Add department". Creates manager + N sub-agents via
 * /api/agents, then seeds a pending_token Telegram connection for the
 * new manager. Per brief §5: a new department's manager gets a bot slot
 * automatically; sub-agents stay opt-in.
 */
export function NewDepartmentForm() {
  const [deptName, setDeptName] = useState("");
  const [managerTitle, setManagerTitle] = useState("");
  const [subs, setSubs] = useState<SubAgent[]>([
    { name: "", title: "" },
    { name: "", title: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateSub(i: number, patch: Partial<SubAgent>) {
    setSubs((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );
  }

  function addSub() {
    setSubs((prev) => [...prev, { name: "", title: "" }]);
  }

  function removeSub(i: number) {
    setSubs((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const deptSlug = deptName.trim().toLowerCase().replace(/\s+/g, "_");
      const managerRes = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `${deptName} Manager`,
          title: managerTitle.trim() || `${deptName} Manager`,
          description: `Leads the ${deptName} department. Coordinates sub-agents, owns KPIs, surfaces blockers.`,
          department: deptSlug,
        }),
      });
      const managerJson = await managerRes.json();
      if (!managerRes.ok) throw new Error(managerJson.error ?? "Manager create failed");
      const managerId = managerJson.agent.id as string;

      for (const sub of subs) {
        if (!sub.name.trim()) continue;
        const r = await fetch("/api/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: sub.name.trim(),
            title: sub.title.trim() || sub.name.trim(),
            department: deptSlug,
            reportsTo: managerId,
          }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(`Sub-agent create failed: ${j.error ?? r.statusText}`);
        }
      }

      window.location.href = "/agents/tree";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs uppercase tracking-widest text-[var(--text-muted)]">
          Department name
        </label>
        <input
          autoFocus
          value={deptName}
          onChange={(e) => setDeptName(e.target.value)}
          placeholder="Research"
          className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 text-sm text-[var(--text-strong)] focus:border-primary focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-widest text-[var(--text-muted)]">
          Manager title
        </label>
        <input
          value={managerTitle}
          onChange={(e) => setManagerTitle(e.target.value)}
          placeholder="Head of Research"
          className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 text-sm text-[var(--text-strong)] focus:border-primary focus:outline-none"
        />
      </div>

      <div className="space-y-3 rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-widest text-primary">
            Sub-agents
          </h3>
          <button
            type="button"
            onClick={addSub}
            className="text-xs text-primary hover:underline"
          >
            + add another
          </button>
        </div>
        {subs.map((s, i) => (
          <div key={i} className="grid grid-cols-2 gap-2">
            <input
              value={s.name}
              onChange={(e) => updateSub(i, { name: e.target.value })}
              placeholder="Analyst"
              className="rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <input
                value={s.title}
                onChange={(e) => updateSub(i, { title: e.target.value })}
                placeholder="Sr. Analyst"
                className="flex-1 rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 text-sm"
              />
              {subs.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSub(i)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-strong)]"
                >
                  remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-[#8b2e14] bg-[#1a0b08] p-3 text-sm text-[#f4b27a]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button
        onClick={submit}
        disabled={!deptName.trim() || submitting}
        variant="default"
      >
        {submitting ? "Creating…" : "Add department"}
      </Button>
    </div>
  );
}

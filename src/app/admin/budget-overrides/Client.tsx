"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { jsonFetcher } from "@/lib/swr";
import type { BudgetDefaults, BudgetOverrideRow } from "./page";

type Role = "ceo" | "deptHead" | "specialist";
const ROLES: ReadonlyArray<Role> = ["ceo", "deptHead", "specialist"];

const ROLE_LABEL: Record<Role, string> = {
  ceo: "CEO",
  deptHead: "Department head",
  specialist: "Specialist",
};

const API = "/api/admin/budget-overrides";

function fmtTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

/**
 * Admin /budget-overrides table. One row per role. Each row shows
 * the global default, the current per-org override (if any), and
 * a save / reset control. Empty override = fall back to default.
 */
export function BudgetOverridesClient({
  initial,
  defaults,
  orgName,
}: {
  initial: BudgetOverrideRow[];
  defaults: BudgetDefaults;
  orgName: string;
}) {
  const { data } = useSWR<{ rows: BudgetOverrideRow[] }>(API, jsonFetcher, {
    fallbackData: { rows: initial },
    refreshInterval: 30_000,
    refreshWhenHidden: false,
    revalidateOnMount: false,
  });
  const rows = data?.rows ?? initial;

  const overridesByRole = new Map<Role, BudgetOverrideRow>();
  for (const r of rows) {
    overridesByRole.set(r.role as Role, r);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Active org: <span className="font-mono">{orgName}</span>
      </p>
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-right">Default</th>
              <th className="px-3 py-2 text-right">Override</th>
              <th className="px-3 py-2 text-left">Updated</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {ROLES.map((role) => (
              <BudgetRow
                key={role}
                role={role}
                defaultBudget={defaults[role]}
                override={overridesByRole.get(role) ?? null}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BudgetRow({
  role,
  defaultBudget,
  override,
}: {
  role: Role;
  defaultBudget: number;
  override: BudgetOverrideRow | null;
}) {
  const [draft, setDraft] = useState<string>(
    override ? String(override.budget_tokens) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const n = Number.parseInt(draft, 10);
    if (!Number.isFinite(n) || n <= 0) {
      setError("must be a positive integer");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(API, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, budget_tokens: n }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? `HTTP ${r.status}`);
        return;
      }
      await mutate(API);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch(`${API}?role=${role}`, { method: "DELETE" });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? `HTTP ${r.status}`);
        return;
      }
      setDraft("");
      await mutate(API);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2">{ROLE_LABEL[role]}</td>
      <td className="px-3 py-2 text-right font-mono">
        {defaultBudget.toLocaleString()}
      </td>
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          min={1}
          step={1000}
          value={draft}
          placeholder="default"
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          className="w-32 rounded border border-border bg-background px-2 py-1 text-right text-sm font-mono"
        />
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground font-mono">
        {fmtTs(override?.updated_at ?? null)}
      </td>
      <td className="px-3 py-2 space-x-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || draft === ""}
          className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={busy || !override}
          className="rounded border border-border px-3 py-1 text-xs disabled:opacity-50"
        >
          Reset
        </button>
        {error ? (
          <span className="ml-2 text-xs text-red-400">{error}</span>
        ) : null}
      </td>
    </tr>
  );
}

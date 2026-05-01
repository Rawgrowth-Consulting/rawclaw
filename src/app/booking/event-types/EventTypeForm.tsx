"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type AgentLite = { id: string; name: string; department: string | null };

type Initial = {
  id?: string;
  slug: string;
  title: string;
  description: string;
  durationMinutes: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  maxBookingsPerDay: number | null;
  active: boolean;
  agentId: string | null;
  locationType: "google_meet" | "phone" | "custom";
  phoneNumber: string;
  customText: string;
};

const empty: Initial = {
  slug: "",
  title: "",
  description: "",
  durationMinutes: 30,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  minNoticeMinutes: 60,
  maxAdvanceDays: 60,
  maxBookingsPerDay: null,
  active: true,
  agentId: null,
  locationType: "google_meet",
  phoneNumber: "",
  customText: "",
};

export function EventTypeForm({
  initial,
  agents,
}: {
  initial?: Partial<Initial>;
  agents: AgentLite[];
}) {
  const router = useRouter();
  const [state, setState] = useState<Initial>({ ...empty, ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch<K extends keyof Initial>(k: K, v: Initial[K]) {
    setState((s) => ({ ...s, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const location =
        state.locationType === "google_meet"
          ? { type: "google_meet" as const }
          : state.locationType === "phone"
          ? { type: "phone" as const, phoneNumber: state.phoneNumber }
          : { type: "custom" as const, customText: state.customText };

      const body = {
        slug: state.slug,
        title: state.title,
        description: state.description,
        durationMinutes: Number(state.durationMinutes),
        color: "sage",
        location,
        rules: {
          bufferBeforeMin: Number(state.bufferBeforeMin),
          bufferAfterMin: Number(state.bufferAfterMin),
          minNoticeMinutes: Number(state.minNoticeMinutes),
          maxAdvanceDays: Number(state.maxAdvanceDays),
          maxBookingsPerDay: state.maxBookingsPerDay === null ? null : Number(state.maxBookingsPerDay),
        },
        customQuestions: [],
        active: state.active,
        agentId: state.agentId,
      };

      const url = state.id
        ? `/api/booking/event-types/${state.id}`
        : "/api/booking/event-types";
      const method = state.id ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Save failed");
        return;
      }
      router.push("/booking/event-types");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!state.id) return;
    if (!confirm("Delete this event type?")) return;
    setSaving(true);
    await fetch(`/api/booking/event-types/${state.id}`, { method: "DELETE" });
    router.push("/booking/event-types");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="space-y-4">
        <Field label="Title">
          <Input value={state.title} onChange={(e) => patch("title", e.target.value)} required />
        </Field>
        <Field label="Slug" hint="lowercase letters, numbers, dashes - shows in the URL">
          <Input
            value={state.slug}
            onChange={(e) => patch("slug", e.target.value)}
            pattern="^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$"
            required
          />
        </Field>
        <Field label="Description">
          <Textarea
            value={state.description}
            onChange={(e) => patch("description", e.target.value)}
            rows={3}
          />
        </Field>
        <Field label="Duration (minutes)">
          <Input
            type="number"
            min={5}
            max={480}
            value={state.durationMinutes}
            onChange={(e) => patch("durationMinutes", Number(e.target.value))}
          />
        </Field>

        <div>
          <Label className="mb-2 block text-xs font-medium uppercase tracking-[1.5px] text-muted-foreground">
            Pin to agent (optional)
          </Label>
          <select
            value={state.agentId ?? ""}
            onChange={(e) => patch("agentId", e.target.value || null)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">None - generic booking</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} {a.department ? `(${a.department})` : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            On confirmed booking, the agent gets a system message in their chat thread.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <Label className="mb-2 block text-xs font-medium uppercase tracking-[1.5px] text-muted-foreground">
            Location
          </Label>
          <select
            value={state.locationType}
            onChange={(e) => patch("locationType", e.target.value as Initial["locationType"])}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="google_meet">Google Meet</option>
            <option value="phone">Phone</option>
            <option value="custom">Custom (text)</option>
          </select>
          {state.locationType === "phone" && (
            <Input
              className="mt-2"
              placeholder="+1 555 123 4567"
              value={state.phoneNumber}
              onChange={(e) => patch("phoneNumber", e.target.value)}
            />
          )}
          {state.locationType === "custom" && (
            <Textarea
              className="mt-2"
              rows={2}
              placeholder="Office address or instructions"
              value={state.customText}
              onChange={(e) => patch("customText", e.target.value)}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Buffer before (min)">
            <Input
              type="number"
              min={0}
              value={state.bufferBeforeMin}
              onChange={(e) => patch("bufferBeforeMin", Number(e.target.value))}
            />
          </Field>
          <Field label="Buffer after (min)">
            <Input
              type="number"
              min={0}
              value={state.bufferAfterMin}
              onChange={(e) => patch("bufferAfterMin", Number(e.target.value))}
            />
          </Field>
          <Field label="Min notice (min)">
            <Input
              type="number"
              min={0}
              value={state.minNoticeMinutes}
              onChange={(e) => patch("minNoticeMinutes", Number(e.target.value))}
            />
          </Field>
          <Field label="Max advance (days)">
            <Input
              type="number"
              min={1}
              max={365}
              value={state.maxAdvanceDays}
              onChange={(e) => patch("maxAdvanceDays", Number(e.target.value))}
            />
          </Field>
          <Field label="Max per day (blank = no cap)">
            <Input
              type="number"
              min={1}
              max={50}
              value={state.maxBookingsPerDay ?? ""}
              onChange={(e) =>
                patch(
                  "maxBookingsPerDay",
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.active}
            onChange={(e) => patch("active", e.target.checked)}
          />
          Active (visible on public booking page)
        </label>
      </div>

      {error && (
        <div className="md:col-span-2 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="md:col-span-2 flex items-center justify-between gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : state.id ? "Save changes" : "Create event type"}
        </Button>
        {state.id && (
          <Button
            type="button"
            variant="ghost"
            className="text-red-400 hover:text-red-300"
            onClick={onDelete}
          >
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-2 block text-xs font-medium uppercase tracking-[1.5px] text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

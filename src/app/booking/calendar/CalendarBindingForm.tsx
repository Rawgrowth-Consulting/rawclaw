"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Calendar = { id: string; summary: string; primary: boolean };

export function CalendarBindingForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [calendarId, setCalendarId] = useState("");
  const [calendarSummary, setCalendarSummary] = useState("");
  const [defaultTimezone, setDefaultTimezone] = useState("UTC");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/booking/calendar");
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "Load failed");
          return;
        }
        setCalendars(data.calendars ?? []);
        if (data.binding) {
          setCalendarId(data.binding.calendarId);
          setCalendarSummary(data.binding.calendarSummary);
          setDefaultTimezone(data.binding.defaultTimezone);
        } else if (data.calendars?.length) {
          const primary = data.calendars.find((c: Calendar) => c.primary) ?? data.calendars[0];
          setCalendarId(primary.id);
          setCalendarSummary(primary.summary);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/booking/calendar", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ calendarId, calendarSummary, defaultTimezone }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(typeof data?.error === "string" ? data.error : "Save failed");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-300">
          {error}
        </div>
      )}

      {calendars.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No calendars listed. Connect Google Calendar in{" "}
          <a href="/connections" className="underline">
            Connections
          </a>{" "}
          first.
        </p>
      ) : (
        <div>
          <Label className="mb-2 block text-xs font-medium uppercase tracking-[1.5px] text-muted-foreground">
            Calendar to write bookings into
          </Label>
          <select
            value={calendarId}
            onChange={(e) => {
              const cal = calendars.find((c) => c.id === e.target.value);
              setCalendarId(e.target.value);
              if (cal) setCalendarSummary(cal.summary);
            }}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summary}
                {c.primary ? " (primary)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <Label className="mb-2 block text-xs font-medium uppercase tracking-[1.5px] text-muted-foreground">
          Default timezone
        </Label>
        <Input
          value={defaultTimezone}
          onChange={(e) => setDefaultTimezone(e.target.value)}
          placeholder="America/Sao_Paulo"
        />
      </div>

      <Button onClick={onSave} disabled={saving || !calendarId}>
        {saving ? "Saving..." : "Save binding"}
      </Button>
    </div>
  );
}

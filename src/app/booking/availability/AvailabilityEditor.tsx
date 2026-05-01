"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Interval = { start: string; end: string };
type WeeklyHours = { dayOfWeek: number; intervals: Interval[] };

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AvailabilityEditor({
  initial,
}: {
  initial: { timezone: string; weeklyHours: WeeklyHours[] };
}) {
  const router = useRouter();
  const [timezone, setTimezone] = useState(initial.timezone);
  const [weeklyHours, setWeeklyHours] = useState<WeeklyHours[]>(initial.weeklyHours);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Browser timezone, picked up after hydration (avoids SSR mismatch).
  const browserTz = useMemo(() => {
    if (typeof Intl === "undefined") return null;
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; }
    catch { return null; }
  }, []);
  const showTzSuggestion = browserTz && browserTz !== timezone;

  function patchInterval(dow: number, idx: number, k: keyof Interval, v: string) {
    setWeeklyHours((wh) =>
      wh.map((d) =>
        d.dayOfWeek === dow
          ? { ...d, intervals: d.intervals.map((it, i) => (i === idx ? { ...it, [k]: v } : it)) }
          : d,
      ),
    );
  }

  function addInterval(dow: number) {
    setWeeklyHours((wh) =>
      wh.map((d) =>
        d.dayOfWeek === dow
          ? { ...d, intervals: [...d.intervals, { start: "09:00", end: "17:00" }] }
          : d,
      ),
    );
  }

  function removeInterval(dow: number, idx: number) {
    setWeeklyHours((wh) =>
      wh.map((d) =>
        d.dayOfWeek === dow
          ? { ...d, intervals: d.intervals.filter((_, i) => i !== idx) }
          : d,
      ),
    );
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/booking/availability", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          timezone,
          weeklyHours,
          dateOverrides: [],
        }),
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

  return (
    <div className="space-y-6">
      <div>
        <Label className="mb-2 block text-xs font-medium uppercase tracking-[1.5px] text-muted-foreground">
          Timezone
        </Label>
        <Input
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="America/Sao_Paulo"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            IANA timezone string. Used to interpret weekly hours.
          </p>
          {showTzSuggestion && (
            <button
              type="button"
              onClick={() => setTimezone(browserTz!)}
              className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/25"
            >
              Use {browserTz}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {weeklyHours.map((d) => (
          <div
            key={d.dayOfWeek}
            className="flex items-start gap-4 rounded-md border border-border bg-card p-3"
          >
            <div className="w-12 pt-2 text-sm font-medium">{dayLabels[d.dayOfWeek]}</div>
            <div className="flex-1 space-y-2">
              {d.intervals.length === 0 ? (
                <div className="text-xs text-muted-foreground">Unavailable</div>
              ) : (
                d.intervals.map((it, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={it.start}
                      onChange={(e) => patchInterval(d.dayOfWeek, idx, "start", e.target.value)}
                      className="w-28"
                    />
                    <span className="text-muted-foreground">to</span>
                    <Input
                      type="time"
                      value={it.end}
                      onChange={(e) => patchInterval(d.dayOfWeek, idx, "end", e.target.value)}
                      className="w-28"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeInterval(d.dayOfWeek, idx)}
                    >
                      Remove
                    </Button>
                  </div>
                ))
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => addInterval(d.dayOfWeek)}
              >
                + Add interval
              </Button>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <Button onClick={onSave} disabled={saving}>
        {saving ? "Saving..." : "Save availability"}
      </Button>
    </div>
  );
}

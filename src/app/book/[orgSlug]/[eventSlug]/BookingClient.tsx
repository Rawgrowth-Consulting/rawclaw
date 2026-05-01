"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SlotsResponse {
  org: { name: string; slug: string };
  title: string;
  timezone: string;
  durationMinutes: number;
  slots: Array<{ startUtc: string; endUtc: string }>;
}

export function BookingClient({
  orgSlug,
  eventSlug,
}: {
  orgSlug: string;
  eventSlug: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<SlotsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const guestTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

  useEffect(() => {
    fetch(`/api/book/${orgSlug}/${eventSlug}/slots`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) {
          setError(body?.error ?? "Load failed");
        } else {
          setData(body);
        }
      })
      .catch((e) => setError((e as Error).message));
  }, [orgSlug, eventSlug]);

  const slotsByDay = useMemo(() => {
    if (!data) return {};
    const out: Record<string, Array<{ startUtc: string; endUtc: string }>> = {};
    for (const s of data.slots) {
      const day = s.startUtc.slice(0, 10);
      out[day] ||= [];
      out[day].push(s);
    }
    return out;
  }, [data]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/book/${orgSlug}/${eventSlug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: eventSlug,
          startUtc: selectedSlot,
          guestName: name,
          guestEmail: email,
          guestTimezone: guestTz,
          customAnswers: {},
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.message ?? body?.error ?? "Booking failed");
        return;
      }
      router.push(`/b/${body.booking.manageToken}?confirmed=1`);
    } finally {
      setSubmitting(false);
    }
  }

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading slots...</p>;

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-8">
        <div className="text-xs uppercase tracking-[1.5px] text-muted-foreground">
          {data.org.name}
        </div>
        <h1 className="mt-1 font-serif text-3xl tracking-tight">{data.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.durationMinutes} min - host timezone {data.timezone} - your timezone {guestTz}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[2fr_1fr]">
        <div>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-[1.5px] text-muted-foreground">
            Pick a slot
          </h2>
          {Object.keys(slotsByDay).length === 0 ? (
            <p className="text-sm text-muted-foreground">No slots available right now.</p>
          ) : (
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
              {Object.entries(slotsByDay).map(([day, slots]) => (
                <div key={day}>
                  <div className="mb-2 text-xs font-medium uppercase tracking-[1.5px] text-muted-foreground">
                    {day}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {slots.map((s) => {
                      const local = new Date(s.startUtc).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                      return (
                        <button
                          key={s.startUtc}
                          type="button"
                          onClick={() => setSelectedSlot(s.startUtc)}
                          className={
                            "rounded-md border px-3 py-2 text-sm transition " +
                            (selectedSlot === s.startUtc
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border hover:border-primary/40")
                          }
                        >
                          {local}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="space-y-4 self-start rounded-md border border-border bg-card p-5">
          <div>
            <Label className="mb-1 block text-xs font-medium uppercase tracking-[1.5px] text-muted-foreground">
              Your name
            </Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <Label className="mb-1 block text-xs font-medium uppercase tracking-[1.5px] text-muted-foreground">
              Your email
            </Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {selectedSlot ? (
            <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
              Selected:{" "}
              <span className="font-mono text-foreground">
                {new Date(selectedSlot).toLocaleString()}
              </span>
            </div>
          ) : (
            <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
              Pick a slot to enable booking.
            </div>
          )}
          <Button type="submit" disabled={!selectedSlot || submitting} className="w-full">
            {submitting ? "Booking..." : "Confirm booking"}
          </Button>
        </form>
      </div>
    </div>
  );
}

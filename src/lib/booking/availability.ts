import { addDays } from "date-fns";
import type { AvailabilityRow, EventTypeRow } from "./types";
import { dayOfWeekInTz, eachDayBetween, zonedDateAt } from "./timezone";

export interface Slot {
  startUtc: Date;
  endUtc: Date;
}

export interface ComputeSlotsInput {
  eventType: EventTypeRow;
  availability: AvailabilityRow;
  busy: Array<{ start: Date; end: Date }>;
  now: Date;
  bookingsPerDay: Record<string, number>;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

// Slot generation: walk each day in availability window, slice into
// duration-sized chunks, drop any that conflict with busy intervals
// (extended by buffer rules) or hit the daily booking cap.
// Pure function - no DB or network. Same algorithm as kalendly's lib/availability.ts.
export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const { eventType, availability, busy, now, bookingsPerDay } = input;
  const tz = availability.timezone;

  const earliestUtc = new Date(now.getTime() + eventType.rules.minNoticeMinutes * 60_000);
  const latestUtc = addDays(now, eventType.rules.maxAdvanceDays);

  const days = eachDayBetween(earliestUtc, latestUtc, tz);
  const slots: Slot[] = [];

  for (const ymd of days) {
    const override = availability.dateOverrides.find((o) => o.date === ymd);
    let intervals: Array<{ start: string; end: string }>;
    if (override) {
      intervals = override.intervals;
    } else {
      const sample = zonedDateAt(ymd, "12:00", tz);
      const dow = dayOfWeekInTz(sample, tz);
      intervals = availability.weeklyHours.find((w) => w.dayOfWeek === dow)?.intervals ?? [];
    }

    if (intervals.length === 0) continue;
    if (
      eventType.rules.maxBookingsPerDay !== null &&
      (bookingsPerDay[ymd] ?? 0) >= eventType.rules.maxBookingsPerDay
    ) {
      continue;
    }

    const cap = eventType.rules.maxBookingsPerDay !== null
      ? eventType.rules.maxBookingsPerDay - (bookingsPerDay[ymd] ?? 0)
      : Number.POSITIVE_INFINITY;

    let emittedToday = 0;

    for (const interval of intervals) {
      const intervalStart = zonedDateAt(ymd, interval.start, tz);
      const intervalEnd = zonedDateAt(ymd, interval.end, tz);

      let cursor = intervalStart;
      while (true) {
        const slotEnd = new Date(cursor.getTime() + eventType.durationMinutes * 60_000);
        if (slotEnd > intervalEnd) break;
        if (cursor < earliestUtc) {
          cursor = new Date(cursor.getTime() + eventType.durationMinutes * 60_000);
          continue;
        }

        const checkStart = new Date(cursor.getTime() - eventType.rules.bufferBeforeMin * 60_000);
        const checkEnd = new Date(slotEnd.getTime() + eventType.rules.bufferAfterMin * 60_000);
        const conflict = busy.some((b) => overlaps(checkStart, checkEnd, b.start, b.end));

        if (!conflict) {
          slots.push({ startUtc: cursor, endUtc: slotEnd });
          emittedToday += 1;
          if (emittedToday >= cap) break;
        }

        cursor = new Date(cursor.getTime() + eventType.durationMinutes * 60_000);
      }
      if (emittedToday >= cap) break;
    }
  }

  return slots;
}

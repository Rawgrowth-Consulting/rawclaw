import { fromZonedTime, toZonedTime } from "date-fns-tz";

export function zonedDateAt(dateYMD: string, timeHM: string, timezone: string): Date {
  return fromZonedTime(`${dateYMD}T${timeHM}:00`, timezone);
}

export function ymdInTz(d: Date, timezone: string): string {
  const z = toZonedTime(d, timezone);
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, "0");
  const day = String(z.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dayOfWeekInTz(d: Date, timezone: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return toZonedTime(d, timezone).getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function eachDayBetween(start: Date, end: Date, timezone: string): string[] {
  const out: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    out.push(ymdInTz(cursor, timezone));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Array.from(new Set(out));
}

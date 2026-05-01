// Booking types. Ported from kalendly_public/lib/types.ts (MIT) with
// Mongo ObjectId -> string UUID and added organization_id field.

export type EventColor = "iris" | "rose" | "amber" | "sage" | "slate";

export type CustomQuestion =
  | { id: string; label: string; type: "short_text" | "long_text"; required: boolean }
  | { id: string; label: string; type: "select"; required: boolean; options: string[] };

export type LocationSpec =
  | { type: "google_meet" }
  | { type: "phone"; phoneNumber: string }
  | { type: "custom"; customText: string };

export interface EventTypeRow {
  id: string;
  organizationId: string;
  slug: string;
  title: string;
  description: string;
  durationMinutes: number;
  color: EventColor;
  location: LocationSpec;
  rules: {
    bufferBeforeMin: number;
    bufferAfterMin: number;
    minNoticeMinutes: number;
    maxAdvanceDays: number;
    maxBookingsPerDay: number | null;
  };
  customQuestions: CustomQuestion[];
  active: boolean;
  position: number;
  agentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AvailabilityRow {
  id: string;
  organizationId: string;
  timezone: string;
  weeklyHours: Array<{
    dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    intervals: Array<{ start: string; end: string }>;
  }>;
  dateOverrides: Array<{
    date: string;
    intervals: Array<{ start: string; end: string }>;
  }>;
  updatedAt: Date;
}

export type BookingStatus = "confirmed" | "cancelled" | "rescheduled";

export interface BookingRow {
  id: string;
  organizationId: string;
  eventTypeId: string;
  eventTypeSlug: string;
  guestName: string;
  guestEmail: string;
  guestTimezone: string;
  customAnswers: Record<string, string>;
  startUtc: Date;
  endUtc: Date;
  googleEventId: string | null;
  meetLink: string | null;
  manageToken: string;
  status: BookingStatus;
  rescheduledToBookingId: string | null;
  notifiedAgentAt: Date | null;
  createdAt: Date;
  cancelledAt: Date | null;
}

export interface CalendarBindingRow {
  id: string;
  organizationId: string;
  calendarId: string;
  calendarSummary: string;
  defaultTimezone: string;
}

export const DEFAULT_AVAILABILITY: Pick<AvailabilityRow, "timezone" | "weeklyHours" | "dateOverrides"> = {
  timezone: "UTC",
  weeklyHours: [
    { dayOfWeek: 0, intervals: [] },
    { dayOfWeek: 1, intervals: [{ start: "09:00", end: "17:00" }] },
    { dayOfWeek: 2, intervals: [{ start: "09:00", end: "17:00" }] },
    { dayOfWeek: 3, intervals: [{ start: "09:00", end: "17:00" }] },
    { dayOfWeek: 4, intervals: [{ start: "09:00", end: "17:00" }] },
    { dayOfWeek: 5, intervals: [{ start: "09:00", end: "17:00" }] },
    { dayOfWeek: 6, intervals: [] },
  ],
  dateOverrides: [],
};

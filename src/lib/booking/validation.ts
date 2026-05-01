import { z } from "zod";

const slugRe = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

export const customQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    label: z.string().min(1).max(120),
    type: z.literal("short_text"),
    required: z.boolean(),
  }),
  z.object({
    id: z.string().min(1),
    label: z.string().min(1).max(120),
    type: z.literal("long_text"),
    required: z.boolean(),
  }),
  z.object({
    id: z.string().min(1),
    label: z.string().min(1).max(120),
    type: z.literal("select"),
    required: z.boolean(),
    options: z.array(z.string().min(1).max(80)).min(1).max(20),
  }),
]);

export const locationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("google_meet") }),
  z.object({ type: z.literal("phone"), phoneNumber: z.string().min(3).max(40) }),
  z.object({ type: z.literal("custom"), customText: z.string().min(1).max(500) }),
]);

export const eventTypeFormSchema = z.object({
  slug: z.string().regex(slugRe),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  durationMinutes: z.number().int().min(5).max(8 * 60),
  color: z.enum(["iris", "rose", "amber", "sage", "slate"]),
  location: locationSchema,
  rules: z.object({
    bufferBeforeMin: z.number().int().min(0).max(240),
    bufferAfterMin: z.number().int().min(0).max(240),
    minNoticeMinutes: z.number().int().min(0).max(7 * 24 * 60),
    maxAdvanceDays: z.number().int().min(1).max(365),
    maxBookingsPerDay: z.number().int().min(1).max(50).nullable(),
  }),
  customQuestions: z.array(customQuestionSchema).max(20),
  active: z.boolean(),
  agentId: z.string().uuid().nullable().optional(),
});

export const availabilityFormSchema = z.object({
  timezone: z.string().min(1),
  weeklyHours: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        intervals: z.array(
          z.object({
            start: z.string().regex(/^\d{2}:\d{2}$/),
            end: z.string().regex(/^\d{2}:\d{2}$/),
          }),
        ),
      }),
    )
    .length(7),
  dateOverrides: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      intervals: z.array(
        z.object({
          start: z.string().regex(/^\d{2}:\d{2}$/),
          end: z.string().regex(/^\d{2}:\d{2}$/),
        }),
      ),
    }),
  ),
});

export const bookingRequestSchema = z.object({
  slug: z.string().regex(slugRe),
  startUtc: z.iso.datetime(),
  guestName: z.string().min(1).max(80),
  guestEmail: z.email().max(254),
  guestTimezone: z.string().min(1),
  customAnswers: z.record(z.string(), z.string().max(2000)),
});

export const calendarBindingFormSchema = z.object({
  calendarId: z.string().min(1),
  calendarSummary: z.string().min(1),
  defaultTimezone: z.string().min(1),
});

export type EventTypeFormInput = z.infer<typeof eventTypeFormSchema>;
export type AvailabilityFormInput = z.infer<typeof availabilityFormSchema>;
export type BookingRequestInput = z.infer<typeof bookingRequestSchema>;

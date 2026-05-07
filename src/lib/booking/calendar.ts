import { composioAction } from "@/lib/mcp/proxy";

// Google Calendar via Composio executeAction. Pedro removed Nango on
// 2026-05-07 so this routes through Composio's catalog actions
// (GOOGLECALENDAR_LIST_CALENDARS / FIND_FREE_SLOTS / CREATE_EVENT /
// DELETE_EVENT) using the org's connection
// (provider_config_key = "composio:google-calendar").

export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface CalendarSummary {
  id: string;
  summary: string;
  primary: boolean;
}

export async function listCalendars(orgId: string): Promise<CalendarSummary[]> {
  const data = await composioAction<{
    items?: Array<Record<string, unknown>>;
  }>(orgId, "google-calendar", "GOOGLECALENDAR_LIST_CALENDARS", {});
  const items = data?.items ?? [];
  return items.map((c) => ({
    id: String(c.id ?? ""),
    summary: String(c.summary ?? c.summaryOverride ?? c.id ?? ""),
    primary: Boolean(c.primary ?? false),
  }));
}

export async function getBusyTimes(
  orgId: string,
  calendarId: string,
  start: Date,
  end: Date,
  timezone: string,
): Promise<BusyInterval[]> {
  const data = await composioAction<{
    calendars?: Record<
      string,
      { busy?: Array<{ start: string; end: string }> }
    >;
  }>(orgId, "google-calendar", "GOOGLECALENDAR_FIND_FREE_SLOTS", {
    time_min: start.toISOString(),
    time_max: end.toISOString(),
    timezone,
    items: [{ id: calendarId }],
  });
  const cal = data?.calendars?.[calendarId];
  return (cal?.busy ?? []).map((b) => ({
    start: new Date(b.start),
    end: new Date(b.end),
  }));
}

export interface CreateEventInput {
  summary: string;
  description: string;
  startUtc: Date;
  durationMinutes: number;
  attendees: Array<{ email: string; displayName?: string }>;
  withMeet: boolean;
}

export interface CreatedEvent {
  googleEventId: string;
  meetLink: string | null;
}

export async function createCalendarEvent(
  orgId: string,
  calendarId: string,
  input: CreateEventInput,
): Promise<CreatedEvent> {
  const endUtc = new Date(
    input.startUtc.getTime() + input.durationMinutes * 60_000,
  );
  const data = await composioAction<Record<string, unknown>>(
    orgId,
    "google-calendar",
    "GOOGLECALENDAR_CREATE_EVENT",
    {
      calendar_id: calendarId,
      summary: input.summary,
      description: input.description,
      start_datetime: input.startUtc.toISOString(),
      end_datetime: endUtc.toISOString(),
      attendees: input.attendees.map((a) => ({
        email: a.email,
        display_name: a.displayName,
      })),
      create_meeting_room: input.withMeet,
      send_updates: "all",
    },
  );
  const id = (data?.id as string | undefined) ?? null;
  if (!id) throw new CalendarError("create_event: missing event id");
  const hangoutLink = (data?.hangoutLink as string | undefined) ?? null;
  const conferenceData = data?.conferenceData as
    | { entryPoints?: Array<{ entryPointType: string; uri: string }> }
    | undefined;
  const meetEntry = conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video",
  );
  const meetLink = hangoutLink ?? meetEntry?.uri ?? null;
  return { googleEventId: id, meetLink };
}

export async function deleteCalendarEvent(
  orgId: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  await composioAction(orgId, "google-calendar", "GOOGLECALENDAR_DELETE_EVENT", {
    calendar_id: calendarId,
    event_id: eventId,
    send_updates: "all",
  });
}

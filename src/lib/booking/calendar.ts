import { nangoCall } from "@/lib/mcp/proxy";

// Google Calendar via Nango proxy. v3's nango() client is reused; we just
// hit the REST endpoints directly. Same outcome as kalendly's Composio
// wrapper but routed through the existing v3 connector pipeline so the
// org's google-calendar OAuth grant is single-source-of-truth.

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
  const data = await nangoCall<{ items?: Array<Record<string, unknown>> }>(
    orgId,
    "google-calendar",
    {
      method: "GET",
      endpoint: "/calendar/v3/users/me/calendarList",
    },
  );
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
  const data = await nangoCall<{
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
  }>(orgId, "google-calendar", {
    method: "POST",
    endpoint: "/calendar/v3/freeBusy",
    data: {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      timeZone: timezone,
      items: [{ id: calendarId }],
    },
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
  const endUtc = new Date(input.startUtc.getTime() + input.durationMinutes * 60_000);
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startUtc.toISOString() },
    end: { dateTime: endUtc.toISOString() },
    attendees: input.attendees.map((a) => ({ email: a.email, displayName: a.displayName })),
  };
  if (input.withMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: `kalendly-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  const data = await nangoCall<Record<string, unknown>>(
    orgId,
    "google-calendar",
    {
      method: "POST",
      endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      params: { conferenceDataVersion: 1, sendUpdates: "all" },
      data: body,
    },
  );
  const id = (data?.id as string | undefined) ?? null;
  if (!id) throw new CalendarError("create_event: missing event id");
  const hangoutLink = (data?.hangoutLink as string | undefined) ?? null;
  const conferenceData = data?.conferenceData as
    | { entryPoints?: Array<{ entryPointType: string; uri: string }> }
    | undefined;
  const meetEntry = conferenceData?.entryPoints?.find((e) => e.entryPointType === "video");
  const meetLink = hangoutLink ?? meetEntry?.uri ?? null;
  return { googleEventId: id, meetLink };
}

export async function deleteCalendarEvent(
  orgId: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  await nangoCall(orgId, "google-calendar", {
    method: "DELETE",
    endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    params: { sendUpdates: "all" },
  });
}

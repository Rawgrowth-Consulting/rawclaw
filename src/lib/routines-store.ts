"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const TRIGGER_KINDS = [
  {
    value: "schedule",
    label: "Schedule",
    description: "Fire on a cron/recurring basis.",
  },
  {
    value: "webhook",
    label: "Webhook",
    description: "Fire when an external service POSTs to a URL.",
  },
  {
    value: "integration",
    label: "Integration event",
    description: "Fire when a connected tool emits an event.",
  },
  {
    value: "manual",
    label: "Manual",
    description: "Only fires when you click Run.",
  },
] as const;

export type TriggerKind = (typeof TRIGGER_KINDS)[number]["value"];

export const SCHEDULE_PRESETS = [
  { value: "every-hour", label: "Every hour", cron: "0 * * * *" },
  { value: "every-day-9am", label: "Every day at 9:00 AM", cron: "0 9 * * *" },
  {
    value: "every-weekday-9am",
    label: "Every weekday at 9:00 AM",
    cron: "0 9 * * 1-5",
  },
  {
    value: "every-monday-9am",
    label: "Every Monday at 9:00 AM",
    cron: "0 9 * * 1",
  },
  { value: "custom", label: "Custom cron...", cron: "" },
] as const;

export type SchedulePreset = (typeof SCHEDULE_PRESETS)[number]["value"];

export const INTEGRATION_EVENTS = [
  {
    value: "fathom.meeting.ended",
    label: "Fathom — Meeting ended",
    integration: "Fathom",
  },
  {
    value: "gdrive.file.created",
    label: "Google Drive — New file in folder",
    integration: "Google Drive",
  },
  {
    value: "gmail.email.received",
    label: "Gmail — Email received",
    integration: "Gmail",
  },
  {
    value: "shopify.order.created",
    label: "Shopify — New order",
    integration: "Shopify",
  },
  {
    value: "stripe.payment.succeeded",
    label: "Stripe — Payment succeeded",
    integration: "Stripe",
  },
  {
    value: "slack.message.posted",
    label: "Slack — Message in channel",
    integration: "Slack",
  },
  {
    value: "hubspot.deal.stage_changed",
    label: "HubSpot — Deal stage changed",
    integration: "HubSpot",
  },
  {
    value: "meta.lead.submitted",
    label: "Meta — Lead form submitted",
    integration: "Meta Business Suite",
  },
] as const;

export type IntegrationEvent = (typeof INTEGRATION_EVENTS)[number]["value"];

export type RoutineTrigger =
  | {
      id: string;
      kind: "schedule";
      enabled: boolean;
      preset: SchedulePreset;
      cron: string;
      timezone: string;
    }
  | {
      id: string;
      kind: "webhook";
      enabled: boolean;
      publicUrl: string;
      signingSecret: string;
    }
  | {
      id: string;
      kind: "integration";
      enabled: boolean;
      event: IntegrationEvent;
    }
  | {
      id: string;
      kind: "manual";
      enabled: boolean;
    };

export type RoutineStatus = "active" | "paused" | "archived";

export type Routine = {
  id: string;
  title: string;
  description: string;
  assigneeAgentId: string | null;
  triggers: RoutineTrigger[];
  status: RoutineStatus;
  lastRunAt: string | null;
  createdAt: string;
};

type RoutinesStore = {
  routines: Routine[];
  hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  createRoutine: (
    input: Omit<Routine, "id" | "status" | "lastRunAt" | "createdAt">,
  ) => Routine;
  updateRoutine: (id: string, patch: Partial<Routine>) => void;
  removeRoutine: (id: string) => void;
  toggleStatus: (id: string) => void;
  runNow: (id: string) => void;
};

function uid(prefix = "rtn") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function newTrigger(kind: TriggerKind): RoutineTrigger {
  switch (kind) {
    case "schedule":
      return {
        id: uid("trg"),
        kind: "schedule",
        enabled: true,
        preset: "every-day-9am",
        cron: "0 9 * * *",
        timezone:
          typeof Intl !== "undefined"
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : "UTC",
      };
    case "webhook":
      return {
        id: uid("trg"),
        kind: "webhook",
        enabled: true,
        publicUrl: `https://aios.rawgrowth.ai/webhooks/${Math.random()
          .toString(36)
          .slice(2, 14)}`,
        signingSecret: `whsec_${Math.random().toString(36).slice(2, 26)}`,
      };
    case "integration":
      return {
        id: uid("trg"),
        kind: "integration",
        enabled: true,
        event: "fathom.meeting.ended",
      };
    case "manual":
      return { id: uid("trg"), kind: "manual", enabled: true };
  }
}

export const useRoutinesStore = create<RoutinesStore>()(
  persist(
    (set) => ({
      routines: [],
      hasHydrated: false,
      setHasHydrated: (v) => set({ hasHydrated: v }),
      createRoutine: (input) => {
        const routine: Routine = {
          ...input,
          id: uid(),
          status: "active",
          lastRunAt: null,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ routines: [routine, ...s.routines] }));
        return routine;
      },
      updateRoutine: (id, patch) =>
        set((s) => ({
          routines: s.routines.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),
      removeRoutine: (id) =>
        set((s) => ({ routines: s.routines.filter((r) => r.id !== id) })),
      toggleStatus: (id) =>
        set((s) => ({
          routines: s.routines.map((r) =>
            r.id === id
              ? { ...r, status: r.status === "active" ? "paused" : "active" }
              : r,
          ),
        })),
      runNow: (id) =>
        set((s) => ({
          routines: s.routines.map((r) =>
            r.id === id ? { ...r, lastRunAt: new Date().toISOString() } : r,
          ),
        })),
    }),
    {
      name: "rawgrowth.routines",
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

// Helpers

export function describeTrigger(t: RoutineTrigger): string {
  switch (t.kind) {
    case "schedule": {
      const preset = SCHEDULE_PRESETS.find((p) => p.value === t.preset);
      return preset && preset.value !== "custom"
        ? preset.label
        : `cron: ${t.cron}`;
    }
    case "webhook":
      return "Webhook URL";
    case "integration": {
      const ev = INTEGRATION_EVENTS.find((e) => e.value === t.event);
      return ev ? ev.label : t.event;
    }
    case "manual":
      return "Manual only";
  }
}

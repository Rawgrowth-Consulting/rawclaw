"use client";

import { useCallback, useMemo } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { jsonFetcher } from "@/lib/swr";
import type { Routine, RoutineCreateInput, RoutineUpdateInput } from "./dto";

const ROUTINES_KEY = "/api/routines";

export function useRoutines() {
  const { data, isLoading, mutate } = useSWR<{ routines: Routine[] }>(
    ROUTINES_KEY,
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  // Stable reference so dependent useCallback hooks don't re-create on every
  // render when SWR returns the same data shape.
  const routines = useMemo(() => data?.routines ?? [], [data?.routines]);
  const hasHydrated = !isLoading;

  const createRoutine = useCallback(
    async (input: RoutineCreateInput): Promise<Routine> => {
      const res = await fetch(ROUTINES_KEY, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const { error } = (await res.json()) as { error?: string };
        throw new Error(error ?? "createRoutine failed");
      }
      const { routine } = (await res.json()) as { routine: Routine };
      await mutate(
        (prev) => ({ routines: [routine, ...(prev?.routines ?? [])] }),
        { revalidate: true },
      );
      return routine;
    },
    [mutate],
  );

  const updateRoutine = useCallback(
    async (id: string, patch: RoutineUpdateInput): Promise<Routine | null> => {
      const res = await fetch(`${ROUTINES_KEY}/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return null;
      const { routine } = (await res.json()) as { routine: Routine };
      await mutate(
        (prev) => ({
          routines: (prev?.routines ?? []).map((r) =>
            r.id === id ? routine : r,
          ),
        }),
        { revalidate: false },
      );
      return routine;
    },
    [mutate],
  );

  const removeRoutine = useCallback(
    async (id: string) => {
      const res = await fetch(`${ROUTINES_KEY}/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const { error } = (await res
          .json()
          .catch(() => ({}))) as { error?: string };
        toast.error(error ?? `Delete failed (HTTP ${res.status})`);
        return;
      }
      await mutate(
        (prev) => ({
          routines: (prev?.routines ?? []).filter((r) => r.id !== id),
        }),
        { revalidate: true },
      );
    },
    [mutate],
  );

  const toggleStatus = useCallback(
    async (id: string) => {
      const current = routines.find((r) => r.id === id);
      if (!current) return;
      const next = current.status === "active" ? "paused" : "active";
      await updateRoutine(id, { status: next });
    },
    [routines, updateRoutine],
  );

  const runNow = useCallback(
    async (id: string) => {
      // Surface API errors (no assignee, dept ACL, 404) to the user.
      // Without this, clicking "Run now" was a silent no-op when the
      // routine wasn't runnable - led to "is this thing on?" reports.
      const res = await fetch(`${ROUTINES_KEY}/${id}/run`, { method: "POST" });
      if (!res.ok) {
        const { error } = (await res
          .json()
          .catch(() => ({}))) as { error?: string };
        toast.error(error ?? `Run failed (HTTP ${res.status})`);
        return;
      }
      toast.success("Routine queued");
      await mutate(
        (prev) => ({
          routines: (prev?.routines ?? []).map((r) =>
            r.id === id
              ? { ...r, lastRunAt: new Date().toISOString() }
              : r,
          ),
        }),
        { revalidate: true },
      );
    },
    [mutate],
  );

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    routines,
    hasHydrated,
    refresh,
    createRoutine,
    updateRoutine,
    removeRoutine,
    toggleStatus,
    runNow,
  };
}

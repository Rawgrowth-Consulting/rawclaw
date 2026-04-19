"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/swr";
import type { Routine, RoutineCreateInput, RoutineUpdateInput } from "./dto";

const ROUTINES_KEY = "/api/routines";

export function useRoutines() {
  const { data, isLoading, mutate } = useSWR<{ routines: Routine[] }>(
    ROUTINES_KEY,
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  const routines = data?.routines ?? [];
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
      await fetch(`${ROUTINES_KEY}/${id}`, { method: "DELETE" });
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
      await fetch(`${ROUTINES_KEY}/${id}/run`, { method: "POST" });
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

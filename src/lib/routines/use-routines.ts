"use client";

import { useCallback, useEffect, useState } from "react";
import type { Routine, RoutineCreateInput, RoutineUpdateInput } from "./dto";

/**
 * Client hook for routine CRUD + status + run-now. Mirrors the old
 * Zustand store surface.
 */
export function useRoutines() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [hasHydrated, setHasHydrated] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/routines");
    const body = (await res.json()) as { routines?: Routine[] };
    setRoutines(body.routines ?? []);
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createRoutine = useCallback(
    async (input: RoutineCreateInput): Promise<Routine> => {
      const res = await fetch("/api/routines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const { error } = (await res.json()) as { error?: string };
        throw new Error(error ?? "createRoutine failed");
      }
      const { routine } = (await res.json()) as { routine: Routine };
      setRoutines((prev) => [routine, ...prev]);
      return routine;
    },
    [],
  );

  const updateRoutine = useCallback(
    async (id: string, patch: RoutineUpdateInput): Promise<Routine | null> => {
      const res = await fetch(`/api/routines/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return null;
      const { routine } = (await res.json()) as { routine: Routine };
      setRoutines((prev) => prev.map((r) => (r.id === id ? routine : r)));
      return routine;
    },
    [],
  );

  const removeRoutine = useCallback(async (id: string) => {
    await fetch(`/api/routines/${id}`, { method: "DELETE" });
    setRoutines((prev) => prev.filter((r) => r.id !== id));
  }, []);

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
      await fetch(`/api/routines/${id}/run`, { method: "POST" });
      // Optimistic bump of lastRunAt so the UI reflects immediately.
      setRoutines((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, lastRunAt: new Date().toISOString() } : r,
        ),
      );
    },
    [],
  );

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

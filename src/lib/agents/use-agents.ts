"use client";

import { useCallback, useEffect, useState } from "react";
import type { Agent, AgentCreateInput, AgentUpdateInput } from "./dto";

/**
 * Client hook for agent CRUD. Mirrors the surface of the old Zustand
 * store so UI components touch minimally:
 *   - agents, hasHydrated
 *   - hireAgent(input) → created Agent
 *   - updateAgent(id, patch)
 *   - removeAgent(id)
 *   - refresh()
 */
export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [hasHydrated, setHasHydrated] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/agents");
    const body = (await res.json()) as { agents?: Agent[] };
    setAgents(body.agents ?? []);
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hireAgent = useCallback(
    async (input: AgentCreateInput): Promise<Agent> => {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const { error } = (await res.json()) as { error?: string };
        throw new Error(error ?? "hireAgent failed");
      }
      const { agent } = (await res.json()) as { agent: Agent };
      // Optimistically splice in, but also refetch so server-set fields land.
      setAgents((prev) => [...prev, agent]);
      return agent;
    },
    [],
  );

  const updateAgent = useCallback(
    async (id: string, patch: AgentUpdateInput): Promise<Agent | null> => {
      const res = await fetch(`/api/agents/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return null;
      const { agent } = (await res.json()) as { agent: Agent };
      setAgents((prev) => prev.map((a) => (a.id === id ? agent : a)));
      return agent;
    },
    [],
  );

  const removeAgent = useCallback(async (id: string) => {
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    setAgents((prev) =>
      prev
        .filter((a) => a.id !== id)
        .map((a) => (a.reportsTo === id ? { ...a, reportsTo: null } : a)),
    );
  }, []);

  return {
    agents,
    hasHydrated,
    refresh,
    hireAgent,
    updateAgent,
    removeAgent,
  };
}

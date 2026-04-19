"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const AGENT_ROLES = [
  { value: "ceo", label: "CEO", icon: "Crown" },
  { value: "cto", label: "CTO", icon: "Cpu" },
  { value: "engineer", label: "Engineer", icon: "Code" },
  { value: "marketer", label: "Marketer", icon: "Megaphone" },
  { value: "sdr", label: "SDR", icon: "PhoneCall" },
  { value: "ops", label: "Ops Manager", icon: "ClipboardList" },
  { value: "designer", label: "Designer", icon: "Palette" },
  { value: "general", label: "General", icon: "Bot" },
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number]["value"];

export const AGENT_RUNTIMES = [
  { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "Anthropic" },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7", provider: "Anthropic" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "Anthropic" },
  { value: "gpt-4.1", label: "GPT-4.1", provider: "OpenAI" },
  { value: "gpt-4o-mini", label: "GPT-4o mini", provider: "OpenAI" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "Google" },
] as const;

export type AgentRuntime = (typeof AGENT_RUNTIMES)[number]["value"];

export const AGENT_STATUSES = ["idle", "running", "paused", "error"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export type Agent = {
  id: string;
  name: string;
  title: string;
  role: AgentRole;
  description: string;
  reportsTo: string | null;
  runtime: AgentRuntime;
  budgetMonthlyUsd: number;
  status: AgentStatus;
  spentMonthlyUsd: number;
  createdAt: string;
};

type AgentsStore = {
  agents: Agent[];
  hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  hireAgent: (input: Omit<Agent, "id" | "status" | "spentMonthlyUsd" | "createdAt">) => Agent;
  removeAgent: (id: string) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  clear: () => void;
};

function uid() {
  return `agt_${Math.random().toString(36).slice(2, 10)}`;
}

export const useAgentsStore = create<AgentsStore>()(
  persist(
    (set) => ({
      agents: [],
      hasHydrated: false,
      setHasHydrated: (v) => set({ hasHydrated: v }),
      hireAgent: (input) => {
        const agent: Agent = {
          ...input,
          id: uid(),
          status: "idle",
          spentMonthlyUsd: 0,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({ agents: [agent, ...state.agents] }));
        return agent;
      },
      removeAgent: (id) =>
        set((state) => ({
          agents: state.agents
            .filter((a) => a.id !== id)
            .map((a) => (a.reportsTo === id ? { ...a, reportsTo: null } : a)),
        })),
      updateAgent: (id, patch) =>
        set((state) => ({
          agents: state.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        })),
      clear: () => set({ agents: [] }),
    }),
    {
      name: "rawgrowth.agents",
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

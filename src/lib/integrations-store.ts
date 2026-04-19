"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthMethod } from "./integrations-catalog";

export type Connection = {
  id: string;
  integrationId: string;
  method: AuthMethod;
  status: "connected";
  connectedAt: string;
  /** Last 4 of the API key (we store the full key locally for dev — NOT production safe). */
  apiKeyMasked?: string;
  apiKeyFull?: string;
  /** OAuth: account label shown in UI (e.g. email). */
  oauthAccount?: string;
  oauthScopes?: string[];
  /** Webhook: generated inbound URL + signing secret for this connection. */
  webhookUrl?: string;
  webhookSecret?: string;
};

type ConnectInput =
  | {
      integrationId: string;
      method: "api_key";
      apiKey: string;
    }
  | {
      integrationId: string;
      method: "oauth";
      account: string;
      scopes: string[];
    }
  | {
      integrationId: string;
      method: "webhook";
    };

type IntegrationsStore = {
  connections: Connection[];
  hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  connect: (input: ConnectInput) => Connection;
  disconnect: (integrationId: string) => void;
  getConnection: (integrationId: string) => Connection | undefined;
  isConnected: (integrationId: string) => boolean;
};

function uid(prefix = "conn") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function randomWebhook(integrationId: string) {
  return {
    url: `https://aios.rawgrowth.ai/api/webhooks/${integrationId}/${Math.random()
      .toString(36)
      .slice(2, 14)}`,
    secret: `whsec_${Math.random().toString(36).slice(2, 30)}`,
  };
}

export const useIntegrationsStore = create<IntegrationsStore>()(
  persist(
    (set, get) => ({
      connections: [],
      hasHydrated: false,
      setHasHydrated: (v) => set({ hasHydrated: v }),
      connect: (input) => {
        // Drop any existing connection for this integration (single-connection model)
        const others = get().connections.filter(
          (c) => c.integrationId !== input.integrationId,
        );
        let conn: Connection;
        const base = {
          id: uid(),
          integrationId: input.integrationId,
          status: "connected" as const,
          connectedAt: new Date().toISOString(),
        };
        if (input.method === "api_key") {
          conn = {
            ...base,
            method: "api_key",
            apiKeyFull: input.apiKey,
            apiKeyMasked: `••••${input.apiKey.slice(-4) || "xxxx"}`,
          };
        } else if (input.method === "oauth") {
          conn = {
            ...base,
            method: "oauth",
            oauthAccount: input.account,
            oauthScopes: input.scopes,
          };
        } else {
          const { url, secret } = randomWebhook(input.integrationId);
          conn = {
            ...base,
            method: "webhook",
            webhookUrl: url,
            webhookSecret: secret,
          };
        }
        set({ connections: [conn, ...others] });
        return conn;
      },
      disconnect: (integrationId) =>
        set((s) => ({
          connections: s.connections.filter(
            (c) => c.integrationId !== integrationId,
          ),
        })),
      getConnection: (integrationId) =>
        get().connections.find((c) => c.integrationId === integrationId),
      isConnected: (integrationId) =>
        get().connections.some((c) => c.integrationId === integrationId),
    }),
    {
      name: "rawgrowth.integrations",
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { listTools } from "@/lib/mcp/registry";
import { listConnectionsForOrg } from "@/lib/connections/queries";
import { providerConfigKeyFor } from "@/lib/nango/providers";
import { getIntegration } from "@/lib/integrations-catalog";

// Force tool registration on cold start.
import "@/lib/mcp/tools";

export const runtime = "nodejs";

type ToolEntry = {
  name: string;
  description: string;
  isWrite: boolean;
};

type IntegrationGroup = {
  id: string;
  name: string;
  connected: boolean;
  tools: ToolEntry[];
};

type Response = {
  integrations: IntegrationGroup[];
  workspace: ToolEntry[];
};

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allTools = listTools();
  const connections = await listConnectionsForOrg(ctx.activeOrgId);
  const connectedKeys = new Set(
    connections
      .filter((c) => c.status === "connected")
      .map((c) => c.provider_config_key),
  );

  const byIntegration = new Map<string, ToolEntry[]>();
  const workspace: ToolEntry[] = [];

  for (const t of allTools) {
    const entry: ToolEntry = {
      name: t.name,
      description: t.description,
      isWrite: Boolean(t.isWrite),
    };
    if (t.requiresIntegration) {
      const list = byIntegration.get(t.requiresIntegration) ?? [];
      list.push(entry);
      byIntegration.set(t.requiresIntegration, list);
    } else {
      workspace.push(entry);
    }
  }

  const integrations: IntegrationGroup[] = [];
  for (const [integrationId, tools] of byIntegration) {
    const catalog = getIntegration(integrationId);
    const providerKey = providerConfigKeyFor(integrationId);
    integrations.push({
      id: integrationId,
      name: catalog?.name ?? integrationId,
      connected: providerKey ? connectedKeys.has(providerKey) : false,
      tools,
    });
  }

  integrations.sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const payload: Response = { integrations, workspace };
  return NextResponse.json(payload);
}

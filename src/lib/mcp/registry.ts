import { getConnection } from "@/lib/connections/queries";
import { providerConfigKeyFor } from "@/lib/nango/providers";
import type { McpTool, ToolContext, ToolResult } from "./types";

/**
 * Central registry. Tool modules import this and call registerTool()
 * at module load time. The /api/mcp route imports registerAllTools()
 * from ./tools once and serves the registered set.
 */

const tools = new Map<string, McpTool>();

export function registerTool(tool: McpTool): void {
  if (tools.has(tool.name)) {
    throw new Error(`Duplicate tool registration: ${tool.name}`);
  }
  tools.set(tool.name, tool);
}

export function listTools() {
  return Array.from(tools.values()).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = tools.get(name);
  if (!tool) {
    return textError(`Unknown tool: ${name}`);
  }

  // Guard: if the tool needs an integration and none is connected, surface a helpful message
  if (tool.requiresIntegration) {
    const pck = providerConfigKeyFor(tool.requiresIntegration);
    if (!pck) {
      return textError(
        `Tool ${name} requires ${tool.requiresIntegration}, but that provider isn't mapped in nango/providers.ts.`,
      );
    }
    const conn = await getConnection(ctx.organizationId, pck);
    if (!conn) {
      return textError(
        `${tool.requiresIntegration} isn't connected for this organization. Connect it at /integrations and retry.`,
      );
    }
  }

  try {
    return await tool.handler(args, ctx);
  } catch (err) {
    return textError(`Tool ${name} failed: ${(err as Error).message}`);
  }
}

export function text(s: string): ToolResult {
  return { content: [{ type: "text", text: s }] };
}

export function textError(s: string): ToolResult {
  return { content: [{ type: "text", text: s }], isError: true };
}

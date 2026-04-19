#!/usr/bin/env node
/**
 * Rawgrowth AIOS — Company LLM MCP server (local dev).
 *
 * Reads from the Postgres index (DATABASE_URL) and exposes it over MCP stdio.
 * Useful for local Claude Desktop testing without deploying. Production uses
 * the HTTP endpoint at /api/mcp instead.
 *
 * Claude Desktop config (~/Library/Application Support/Claude/claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "rawgrowth-aios-local": {
 *       "command": "npx",
 *       "args": ["tsx", "<absolute-path>/scripts/mcp-server.ts"]
 *     }
 *   }
 * }
 */

import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  fileCount,
  getFile,
  getSyncState,
  listRecentFiles,
  searchDrive,
} from "../src/lib/google/drive.js";

const server = new Server(
  {
    name: "rawgrowth-aios",
    version: "0.1.0",
  },
  {
    capabilities: { tools: {} },
  },
);

// ────────────────────────── Tool definitions ──────────────────────────

const tools = [
  {
    name: "search_drive",
    description:
      "Full-text search across the user's Google Drive files. Returns title + snippet + link per hit. Use this for topical queries like 'pricing SOP' or 'Q4 plan'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (FTS5 syntax supported)" },
        limit: {
          type: "number",
          description: "Max results (default 10, max 30)",
          default: 10,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_drive_file",
    description:
      "Fetch the full indexed content of a specific Drive file by its id (returned from search_drive or list_recent_drive_files).",
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "Google Drive file id" },
      },
      required: ["file_id"],
    },
  },
  {
    name: "list_recent_drive_files",
    description:
      "List the most recently modified Drive files. Use to see what's fresh.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 25 },
      },
    },
  },
  {
    name: "drive_sync_status",
    description:
      "Returns index health: total files indexed, last sync time. Use when the user asks 'is my data fresh?'.",
    inputSchema: { type: "object", properties: {} },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

// ────────────────────────── Tool execution ──────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case "search_drive": {
        const query = String((args as Record<string, unknown>)?.query ?? "");
        const limit = Math.min(
          Number((args as Record<string, unknown>)?.limit ?? 10) || 10,
          30,
        );
        const hits = await searchDrive(query, limit);
        return {
          content: [
            {
              type: "text",
              text:
                hits.length === 0
                  ? `No results for "${query}".`
                  : formatSearchResults(query, hits),
            },
          ],
        };
      }

      case "get_drive_file": {
        const fileId = String((args as Record<string, unknown>)?.file_id ?? "");
        const file = await getFile(fileId);
        if (!file) {
          return {
            content: [{ type: "text", text: `File ${fileId} not found.` }],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text",
              text: [
                `# ${file.title}`,
                `*Modified ${new Date(file.modified_at).toISOString()} — ${file.mime_type}*`,
                file.web_view_link ? `[Open in Drive](${file.web_view_link})` : "",
                "",
                "---",
                "",
                file.content || "_(no indexed content — binary file)_",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        };
      }

      case "list_recent_drive_files": {
        const limit = Math.min(
          Number((args as Record<string, unknown>)?.limit ?? 25) || 25,
          100,
        );
        const files = await listRecentFiles(limit);
        return {
          content: [
            {
              type: "text",
              text:
                files.length === 0
                  ? "No files indexed yet. Connect Google Drive in the Rawgrowth app and wait for the first sync."
                  : files
                      .map(
                        (f) =>
                          `- **${f.title}** (${f.mime_type}) — ${new Date(f.modified_at).toISOString()}\n  file_id: \`${f.file_id}\`${f.web_view_link ? ` · [link](${f.web_view_link})` : ""}`,
                      )
                      .join("\n"),
            },
          ],
        };
      }

      case "drive_sync_status": {
        const [state, count] = await Promise.all([getSyncState(), fileCount()]);
        return {
          content: [
            {
              type: "text",
              text: [
                `**Drive files indexed:** ${count}`,
                state?.lastRunAt
                  ? `**Last sync:** ${new Date(state.lastRunAt).toISOString()}`
                  : "**Last sync:** never — connect Google Drive in the Rawgrowth app.",
              ].join("\n"),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Tool error: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }
});

function formatSearchResults(
  query: string,
  hits: Awaited<ReturnType<typeof searchDrive>>,
) {
  return [
    `Found ${hits.length} result(s) for "${query}":`,
    "",
    ...hits.map(
      (h, i) =>
        `${i + 1}. **${h.title}** _(${h.mime_type})_
   ${h.snippet}
   file_id: \`${h.file_id}\`${h.web_view_link ? ` · [open](${h.web_view_link})` : ""}`,
    ),
  ].join("\n");
}

// ────────────────────────── Boot ──────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[rawgrowth-aios MCP] ready on stdio");
}

main().catch((err) => {
  console.error("[rawgrowth-aios MCP] fatal:", err);
  process.exit(1);
});

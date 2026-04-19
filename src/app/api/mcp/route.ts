import { NextResponse, type NextRequest } from "next/server";
import {
  fileCount,
  getFile,
  getSyncState,
  listRecentFiles,
  searchDrive,
  type SearchHit,
} from "@/lib/google/drive";

/**
 * Streamable HTTP MCP endpoint (stateless variant).
 * Accepts JSON-RPC 2.0 requests compatible with the Model Context Protocol
 * so that Claude Desktop / Claude Code / Cursor can call our tools remotely.
 *
 * Auth: Bearer token in Authorization header, checked against MCP_BEARER_TOKEN.
 *
 * For MVP we support three JSON-RPC methods:
 *   - initialize
 *   - tools/list
 *   - tools/call
 * Every request is independent — no session state.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const PROTOCOL_VERSION = "2024-11-05";

const tools = [
  {
    name: "search_drive",
    description:
      "Full-text search across the user's Google Drive files. Returns title + snippet + link per hit.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_drive_file",
    description:
      "Fetch the full indexed content of a specific Drive file by its id.",
    inputSchema: {
      type: "object",
      properties: { file_id: { type: "string" } },
      required: ["file_id"],
    },
  },
  {
    name: "list_recent_drive_files",
    description: "List the most recently modified Drive files.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", default: 25 } },
    },
  },
  {
    name: "drive_sync_status",
    description:
      "Index health: total files indexed + last sync time. Use when the user asks 'is my data fresh?'.",
    inputSchema: { type: "object", properties: {} },
  },
];

type JsonRpc = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

function reply(id: JsonRpc["id"] | undefined, result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}

function replyError(
  id: JsonRpc["id"] | undefined,
  code: number,
  message: string,
  data?: unknown,
) {
  return {
    jsonrpc: "2.0" as const,
    id: id ?? null,
    error: { code, message, ...(data ? { data } : {}) },
  };
}

function isAuthorized(req: NextRequest) {
  const expected = process.env.MCP_BEARER_TOKEN;
  if (!expected) return true; // no token set = open (local dev only)
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown> = {},
) {
  switch (name) {
    case "search_drive": {
      const query = String(args.query ?? "");
      const limit = Math.min(Number(args.limit ?? 10) || 10, 30);
      const hits = await searchDrive(query, limit);
      return textResult(
        hits.length === 0
          ? `No results for "${query}".`
          : formatSearchResults(query, hits),
      );
    }
    case "get_drive_file": {
      const fileId = String(args.file_id ?? "");
      const file = await getFile(fileId);
      if (!file) return textResult(`File ${fileId} not found.`, true);
      return textResult(
        [
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
      );
    }
    case "list_recent_drive_files": {
      const limit = Math.min(Number(args.limit ?? 25) || 25, 100);
      const files = await listRecentFiles(limit);
      if (files.length === 0) {
        return textResult(
          "No files indexed yet. Connect Google Drive in the Rawgrowth app and wait for the first sync.",
        );
      }
      return textResult(
        files
          .map(
            (f) =>
              `- **${f.title}** (${f.mime_type}) — ${new Date(f.modified_at).toISOString()}\n  file_id: \`${f.file_id}\`${f.web_view_link ? ` · [link](${f.web_view_link})` : ""}`,
          )
          .join("\n"),
      );
    }
    case "drive_sync_status": {
      const [state, count] = await Promise.all([getSyncState(), fileCount()]);
      return textResult(
        [
          `**Drive files indexed:** ${count}`,
          state?.lastRunAt
            ? `**Last sync:** ${new Date(state.lastRunAt).toISOString()}`
            : "**Last sync:** never — connect Google Drive in the Rawgrowth app.",
        ].join("\n"),
      );
    }
    default:
      return textResult(`Unknown tool: ${name}`, true);
  }
}

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

function formatSearchResults(query: string, hits: SearchHit[]) {
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

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      replyError(null, -32001, "Unauthorized"),
      { status: 401 },
    );
  }

  let msg: JsonRpc;
  try {
    msg = (await req.json()) as JsonRpc;
  } catch {
    return NextResponse.json(replyError(null, -32700, "Parse error"), {
      status: 400,
    });
  }

  if (msg.jsonrpc !== "2.0" || !msg.method) {
    return NextResponse.json(replyError(msg.id, -32600, "Invalid Request"));
  }

  try {
    switch (msg.method) {
      case "initialize":
        return NextResponse.json(
          reply(msg.id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "rawgrowth-aios", version: "0.1.0" },
          }),
        );
      case "notifications/initialized":
        // Notification — no response expected
        return new NextResponse(null, { status: 204 });
      case "tools/list":
        return NextResponse.json(reply(msg.id, { tools }));
      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        const result = await handleToolCall(name, args);
        return NextResponse.json(reply(msg.id, result));
      }
      default:
        return NextResponse.json(
          replyError(msg.id, -32601, `Method not found: ${msg.method}`),
        );
    }
  } catch (err) {
    return NextResponse.json(
      replyError(msg.id, -32000, (err as Error).message),
    );
  }
}

// Many MCP clients probe with GET before POSTing. Return a small banner.
export async function GET() {
  return NextResponse.json({
    server: "rawgrowth-aios",
    version: "0.1.0",
    transport: "streamable-http",
    protocolVersion: PROTOCOL_VERSION,
  });
}

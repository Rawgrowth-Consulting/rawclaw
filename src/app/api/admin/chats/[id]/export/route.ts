import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { isChatId, loadChatTraceForExport } from "@/lib/admin/chat-export";

export const runtime = "nodejs";

/**
 * GET /api/admin/chats/[id]/export
 *
 * Returns the full chat trace (every message + per-turn reasoning
 * + tool_calls + tool_results) for the given agent id ("chatId").
 * Admin-only. orgId pinned from the verified session.
 *
 * v1 ships direct JSON download. Signed-URL / storage-backed
 * variant is a v2 follow-up once the export size justifies it.
 */
export async function GET(
  _req: Request,
  ctxParam: { params: Promise<{ id: string }> },
) {
  const { id } = await ctxParam.params;
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin || !ctx.activeOrgId) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  if (!isChatId(id)) {
    return NextResponse.json(
      { error: "chat id must be a uuid" },
      { status: 400 },
    );
  }
  const { trace, error } = await loadChatTraceForExport(ctx.activeOrgId, id);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  if (trace.messageCount === 0) {
    return NextResponse.json({ error: "chat not found" }, { status: 404 });
  }
  return new NextResponse(JSON.stringify(trace, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="chat-${id}.json"`,
    },
  });
}

import { NextResponse, type NextRequest } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import {
  extractSopSchedule,
  findBestAgent,
  loadSopContent,
} from "@/app/api/sops/[id]/schedule/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/sops/[id]/schedule/preview
 *
 * Reads the knowledge file, runs the LLM extraction prompt, picks the
 * best-match agent, and returns the proposed routine fields without
 * persisting anything. The ScheduleSopModal uses this on open so the
 * operator can review + override before clicking Save.
 *
 * Same contract as POST /schedule but no rows created. Splitting the
 * preview from the create lets the modal warn cleanly when the SOP is
 * empty or the LLM call times out, before any DB writes happen.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const orgId = ctx.activeOrgId;

    const { title, content } = await loadSopContent(orgId, id);
    const extraction = await extractSopSchedule(content);
    const agent = await findBestAgent(orgId, extraction.agentRole);
    if (!agent) {
      return NextResponse.json(
        { error: "no_agents_in_org" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      knowledgeFileId: id,
      fileName: title,
      cron: extraction.cron,
      timezone: extraction.timezone,
      agentRole: extraction.agentRole,
      actionSummary: extraction.actionSummary,
      agent: {
        id: agent.id,
        name: agent.name,
        title: agent.title,
        department: agent.department,
        isDepartmentHead: agent.isDepartmentHead,
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "knowledge_file_not_found") {
      return NextResponse.json(
        { error: "Knowledge file not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextResponse, type NextRequest } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  extractSopSchedule,
  findBestAgent,
  loadSopContent,
} from "@/app/api/sops/[id]/schedule/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/sops/[id]/schedule
 *
 * Body: {
 *   cron?: string;            // operator override
 *   timezone?: string;        // operator override
 *   agentId?: string;         // operator override (must belong to org)
 *   actionSummary?: string;   // operator override (5-10 word imperative)
 * }
 *
 * Pipeline:
 *  1. Auth via getOrgContext().
 *  2. Read the knowledge file (full SOP markdown becomes routine.description).
 *  3. Call chatComplete to extract default {cron, timezone, agent_role,
 *     action_summary}. Operator overrides win.
 *  4. Match the agent by role keyword, falling back to first active
 *     dept-head, then first agent in org.
 *  5. Insert rgaios_routines (status=active, assignee=matched agent).
 *  6. Insert rgaios_routine_triggers (kind=schedule, enabled=true,
 *     config={cron, timezone, preset:'sop', sop_knowledge_file_id}).
 *  7. Best-effort cleanup of the orphan routine if the trigger insert
 *     fails  -  same pattern as autonomous-heartbeat seedManager.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const orgId = ctx.activeOrgId;

    const body = (await req.json().catch(() => ({}))) as {
      cron?: unknown;
      timezone?: unknown;
      agentId?: unknown;
      actionSummary?: unknown;
    };

    const { title: fileTitle, content } = await loadSopContent(orgId, id);
    const extraction = await extractSopSchedule(content);

    const cron =
      typeof body.cron === "string" && body.cron.trim()
        ? body.cron.trim()
        : extraction.cron;
    const timezone =
      typeof body.timezone === "string" && body.timezone.trim()
        ? body.timezone.trim()
        : extraction.timezone;
    const actionSummary =
      typeof body.actionSummary === "string" && body.actionSummary.trim()
        ? body.actionSummary.trim()
        : extraction.actionSummary;

    let agentId: string | null = null;
    if (typeof body.agentId === "string" && body.agentId.trim()) {
      // Verify operator-supplied agent belongs to the active org. Cross-tenant
      // guard parity with the agent-chat route.
      const { data: agentRow } = await supabaseAdmin()
        .from("rgaios_agents")
        .select("id")
        .eq("organization_id", orgId)
        .eq("id", body.agentId.trim())
        .maybeSingle();
      if (!agentRow) {
        return NextResponse.json(
          { error: "agent_not_in_org" },
          { status: 400 },
        );
      }
      agentId = agentRow.id;
    } else {
      const matched = await findBestAgent(orgId, extraction.agentRole);
      if (!matched) {
        return NextResponse.json(
          { error: "no_agents_in_org" },
          { status: 400 },
        );
      }
      agentId = matched.id;
    }

    const db = supabaseAdmin();
    const { data: routine, error: routineErr } = await db
      .from("rgaios_routines")
      .insert({
        organization_id: orgId,
        title: `Scheduled SOP: ${actionSummary}`,
        description: content || `(empty SOP: ${fileTitle})`,
        assignee_agent_id: agentId,
        status: "active",
      })
      .select("id")
      .single();
    if (routineErr || !routine) {
      throw new Error(
        `routine_insert_failed: ${routineErr?.message ?? "no row"}`,
      );
    }

    const { data: trigger, error: triggerErr } = await db
      .from("rgaios_routine_triggers")
      .insert({
        organization_id: orgId,
        routine_id: routine.id,
        kind: "schedule",
        enabled: true,
        config: {
          cron,
          timezone,
          preset: "sop",
          sop_knowledge_file_id: id,
        },
      })
      .select("id")
      .single();
    if (triggerErr || !trigger) {
      // Best-effort orphan cleanup so the next attempt is idempotent.
      await db.from("rgaios_routines").delete().eq("id", routine.id);
      throw new Error(
        `trigger_insert_failed: ${triggerErr?.message ?? "no row"}`,
      );
    }

    await db.from("rgaios_audit_log").insert({
      organization_id: orgId,
      kind: "sop_scheduled",
      actor_type: "user",
      actor_id: ctx.userId,
      detail: {
        knowledge_file_id: id,
        routine_id: routine.id,
        trigger_id: trigger.id,
        agent_id: agentId,
        cron,
      },
    });

    return NextResponse.json({
      ok: true,
      routineId: routine.id,
      triggerId: trigger.id,
      agentId,
      cron,
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

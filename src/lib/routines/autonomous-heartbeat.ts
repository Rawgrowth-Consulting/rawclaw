import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Autonomous heartbeat routines.
 *
 * Brief §9.6 acceptance: "VPS runs 1h with no input, no errors, no
 * runaway loops, no duplicated tasks." The user-defined cron path
 * (schedule-tick + rawgrowth-tick.timer) only fires routines an
 * operator created. With zero such routines on a fresh install, the
 * 1-hour idle test produces zero activity-feed events and §9.6 fails.
 *
 * The fix: seed ONE autonomous routine per default manager (department
 * head) at provisioning time. The routine fires every 2 minutes through
 * the same schedule-tick path, hitting the same dispatchRun() pipeline
 * that user routines do. Hard caps (10 iter, 120 s wall) from
 * src/lib/runs/executor.ts still apply per run.
 *
 * Sub-agent guard: per brief §9.6 + §9 auto-fail, sub-agents are
 * pinged-only. We refuse to seed for any agent where reports_to is
 * non-null OR is_department_head is false. The schedule-tick handler
 * already enforces a runtime guard (it skips routines whose assignee
 * has reports_to set), so this is defence-in-depth at seed time.
 *
 * Idempotency: marker = trigger.config.autonomous_heartbeat=true. We
 * select-then-skip rather than delete-and-recreate so re-running the
 * seed is a no-op and we never lose last_fired_at history.
 */

const HEARTBEAT_CRON = "*/2 * * * *";
const HEARTBEAT_TIMEZONE = "UTC";
const HEARTBEAT_MARKER_KEY = "autonomous_heartbeat";
const HEARTBEAT_ROUTINE_TITLE_PREFIX = "Autonomous heartbeat";

/** Marker stored in trigger config so we can find these triggers later. */
export const HEARTBEAT_TRIGGER_MARKER = HEARTBEAT_MARKER_KEY;
export const HEARTBEAT_TRIGGER_CRON = HEARTBEAT_CRON;

type AgentRow = {
  id: string;
  name: string;
  title: string | null;
  role: string;
  reports_to: string | null;
  is_department_head: boolean | null;
  department: string | null;
};

export type SeedAutonomousResult =
  | { seeded: true; routineId: string; triggerId: string }
  | { seeded: false; reason: string };

function buildHeartbeatPrompt(agent: AgentRow): string {
  const role =
    agent.title?.trim() ||
    agent.department?.trim() ||
    agent.role?.trim() ||
    "department";
  return [
    `You are ${agent.name}, the ${role} manager. This is an autonomous heartbeat tick - it runs every two minutes whether or not a human is around.`,
    "",
    "Procedure for this tick (do EXACTLY one of these, in order of priority):",
    "1. Check your inbox. If there is at least one unanswered Telegram message addressed to you, draft and send ONE reply to the oldest message. Stop after the reply.",
    "2. If your inbox is empty, identify ONE concrete next planning step for your department - a single brief message to a sub-agent, a memory note via agents_update, or a routines_create call for a follow-up task. Take that one step. Stop.",
    "3. If everything is already up to date AND there is nothing new to plan, respond with the literal phrase 'Idle: nothing to do this tick.' and stop.",
    "",
    "Hard rules:",
    "- Do NOT loop. One concrete action per tick or one idle ack. The executor will call you again on the next heartbeat.",
    "- Do NOT spawn duplicate routines. Before calling routines_create, check recent memory entries for the same title.",
    "- Do NOT escalate. Stay inside your department.",
  ].join("\n");
}

/**
 * Seed a single autonomous heartbeat routine for one department-head
 * agent. Idempotent: returns seeded=false (reason='already_exists') if
 * a heartbeat routine already exists for this agent.
 *
 * Refuses to seed for sub-agents. A sub-agent is any agent where
 * reports_to is non-null OR is_department_head is false. Returns
 * seeded=false (reason='sub_agent') in that case - never throws.
 */
export async function seedAutonomousRoutineForManager(
  organizationId: string,
  agentId: string,
): Promise<SeedAutonomousResult> {
  const db = supabaseAdmin();

  const { data: agentRow, error: agentErr } = await db
    .from("rgaios_agents")
    .select("id, name, title, role, reports_to, is_department_head, department")
    .eq("id", agentId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (agentErr) {
    return { seeded: false, reason: `agent_lookup_failed: ${agentErr.message}` };
  }
  if (!agentRow) {
    return { seeded: false, reason: "agent_not_found" };
  }

  const agent = agentRow as AgentRow;

  // Sub-agent guard. Brief §9.6 + §9 auto-fail: sub-agents are
  // pinged-only. We refuse to seed if EITHER condition holds:
  //   - reports_to is set (this agent has a manager above it), OR
  //   - is_department_head is false (this agent is not a head).
  // Both conditions normally hold for sub-agents, but we guard against
  // either independently because is_department_head was added in
  // migration 0033 and older rows could have reports_to=null with
  // is_department_head=false.
  if (agent.reports_to) {
    return { seeded: false, reason: "sub_agent" };
  }
  if (agent.is_department_head === false) {
    return { seeded: false, reason: "not_department_head" };
  }

  // Idempotency check: look for an existing heartbeat trigger pinned
  // to a routine assigned to this agent. We match on the marker key in
  // config so a user can't accidentally collide by naming a routine
  // similarly. limit(1) + skip; never delete + recreate.
  const { data: existing, error: existingErr } = await db
    .from("rgaios_routine_triggers")
    .select("id, routine_id, config, rgaios_routines!inner(assignee_agent_id)")
    .eq("organization_id", organizationId)
    .eq("kind", "schedule")
    .filter(`config->>${HEARTBEAT_MARKER_KEY}`, "eq", "true")
    .filter("rgaios_routines.assignee_agent_id", "eq", agentId)
    .limit(1);
  if (existingErr) {
    return { seeded: false, reason: `existing_lookup_failed: ${existingErr.message}` };
  }
  if (existing && existing.length > 0) {
    return { seeded: false, reason: "already_exists" };
  }

  // Insert routine first, then trigger. If trigger insert fails we
  // best-effort delete the routine so the next call retries cleanly
  // instead of finding an orphan routine with no trigger.
  const { data: routine, error: routineErr } = await db
    .from("rgaios_routines")
    .insert({
      organization_id: organizationId,
      title: `${HEARTBEAT_ROUTINE_TITLE_PREFIX}: ${agent.name}`,
      description: buildHeartbeatPrompt(agent),
      assignee_agent_id: agentId,
      status: "active",
    })
    .select("id")
    .single();
  if (routineErr || !routine) {
    return {
      seeded: false,
      reason: `routine_insert_failed: ${routineErr?.message ?? "no row"}`,
    };
  }

  const { data: trigger, error: triggerErr } = await db
    .from("rgaios_routine_triggers")
    .insert({
      organization_id: organizationId,
      routine_id: routine.id,
      kind: "schedule",
      enabled: true,
      config: {
        cron: HEARTBEAT_CRON,
        timezone: HEARTBEAT_TIMEZONE,
        preset: "custom",
        [HEARTBEAT_MARKER_KEY]: true,
      },
    })
    .select("id")
    .single();
  if (triggerErr || !trigger) {
    // Clean up the orphan routine. Best-effort - if the cleanup fails
    // the next seed call will still see no trigger and try again,
    // creating a duplicate routine. Acceptable trade-off vs. leaving
    // the partial state behind permanently.
    await db.from("rgaios_routines").delete().eq("id", routine.id);
    return {
      seeded: false,
      reason: `trigger_insert_failed: ${triggerErr?.message ?? "no row"}`,
    };
  }

  await db.from("rgaios_audit_log").insert({
    organization_id: organizationId,
    kind: "autonomous_heartbeat_seeded",
    actor_type: "system",
    actor_id: "autonomous_heartbeat",
    detail: {
      agent_id: agentId,
      agent_name: agent.name,
      routine_id: routine.id,
      trigger_id: trigger.id,
      cron: HEARTBEAT_CRON,
    },
  });

  return { seeded: true, routineId: routine.id, triggerId: trigger.id };
}

/**
 * Seed autonomous heartbeats for every department-head agent in an
 * organization. Mirrors seedTelegramConnectionsForDefaults' shape so
 * the call sites that already wire Telegram for the three default
 * managers can wire the heartbeat in the same pass.
 *
 * Returns a per-agent result so callers can audit. Sub-agents are
 * filtered out before any insert attempt, so the result counts only
 * eligible managers.
 */
export async function seedAutonomousRoutinesForOrganization(
  organizationId: string,
): Promise<{
  seeded: number;
  skipped: number;
  results: Array<{ agentId: string; result: SeedAutonomousResult }>;
}> {
  const db = supabaseAdmin();

  // Pull every potential manager in the org. We filter on
  // is_department_head=true server-side so sub-agents never even get
  // a per-row seed call.
  const { data: agents, error } = await db
    .from("rgaios_agents")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_department_head", true)
    .is("reports_to", null);
  if (error) {
    return { seeded: 0, skipped: 0, results: [] };
  }
  const list = (agents ?? []) as Array<{ id: string }>;
  if (list.length === 0) {
    return { seeded: 0, skipped: 0, results: [] };
  }

  let seeded = 0;
  let skipped = 0;
  const results: Array<{ agentId: string; result: SeedAutonomousResult }> = [];
  for (const a of list) {
    const r = await seedAutonomousRoutineForManager(organizationId, a.id);
    results.push({ agentId: a.id, result: r });
    if (r.seeded) seeded += 1;
    else skipped += 1;
  }
  return { seeded, skipped, results };
}

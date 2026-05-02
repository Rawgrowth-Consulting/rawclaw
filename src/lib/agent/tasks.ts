import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchRun } from "@/lib/runs/dispatch";

/**
 * Chat-driven task creation. The agent ends a reply with one or more
 * <task assignee="..."> blocks; we strip them, create rgaios_routines
 * rows for the assigned agent, kick a pending rgaios_routine_runs row,
 * and dispatchRun for execution.
 *
 * Format the agent must emit (documented in src/lib/agent/preamble.ts):
 *
 *   <task assignee="self|<agent-role>|<agent-name>">
 *   Title: short imperative line
 *   Description: one or two sentences with the goal + outcome
 *   </task>
 *
 * `assignee` resolution order:
 *   1. literal "self" - assigns to the speaking agent
 *   2. exact match on agent.role within the org (e.g. "marketer", "sdr")
 *   3. case-insensitive match on agent.name within the org
 *   4. fallback - assigns to the speaking agent so nothing is lost
 *
 * Returns the modified reply (blocks stripped) + the list of created
 * task rows so the chat route can echo them back to the client.
 */

const TASK_BLOCK_RE = /<task(?:\s+assignee="([^"]*)")?>([\s\S]*?)<\/task>/gi;

export type CreatedTask = {
  routineId: string;
  runId: string | null;
  title: string;
  assigneeAgentId: string;
  assigneeName: string;
};

export type ExtractTasksResult = {
  visibleReply: string;
  tasks: CreatedTask[];
};

export async function extractAndCreateTasks(input: {
  orgId: string;
  speakerAgentId: string;
  reply: string;
}): Promise<ExtractTasksResult> {
  const { orgId, speakerAgentId, reply } = input;
  const matches = [...reply.matchAll(TASK_BLOCK_RE)];
  if (matches.length === 0) {
    return { visibleReply: reply, tasks: [] };
  }

  // Strip blocks from the visible text first - even if creation fails,
  // the user shouldn't see the raw XML.
  const visibleReply = reply.replace(TASK_BLOCK_RE, "").trim();

  const db = supabaseAdmin();

  // Pull all agents in this org once so we can resolve assignee strings
  // without N round trips.
  const { data: agents } = await db
    .from("rgaios_agents")
    .select("id, name, role, department")
    .eq("organization_id", orgId);
  const allAgents = (agents ?? []) as Array<{
    id: string;
    name: string;
    role: string | null;
    department: string | null;
  }>;
  const speaker = allAgents.find((a) => a.id === speakerAgentId);

  function resolveAssignee(label: string | null): {
    id: string;
    name: string;
  } {
    const raw = (label ?? "self").trim().toLowerCase();
    if (raw === "self" || raw === "" || raw === speaker?.role?.toLowerCase()) {
      return {
        id: speakerAgentId,
        name: speaker?.name ?? "this agent",
      };
    }
    const byRole = allAgents.find(
      (a) => (a.role ?? "").toLowerCase() === raw,
    );
    if (byRole) return { id: byRole.id, name: byRole.name };
    const byName = allAgents.find(
      (a) => a.name.toLowerCase() === raw,
    );
    if (byName) return { id: byName.id, name: byName.name };
    return {
      id: speakerAgentId,
      name: speaker?.name ?? "this agent",
    };
  }

  const tasks: CreatedTask[] = [];
  for (const m of matches) {
    const assigneeLabel = m[1] ?? null;
    const body = (m[2] ?? "").trim();
    if (!body) continue;
    const titleMatch = body.match(/Title:\s*(.+)/i);
    const descMatch = body.match(/Description:\s*([\s\S]+)/i);
    const title = (titleMatch?.[1] ?? body.split("\n")[0] ?? "Task")
      .trim()
      .slice(0, 200);
    const description = (descMatch?.[1] ?? body).trim().slice(0, 4000);

    const assignee = resolveAssignee(assigneeLabel);

    // Insert the routine row.
    const { data: routine, error: routineErr } = await db
      .from("rgaios_routines")
      .insert({
        organization_id: orgId,
        title,
        description,
        assignee_agent_id: assignee.id,
        status: "active",
      } as never)
      .select("id")
      .single();
    if (routineErr || !routine) {
      console.warn(
        `[tasks] routine insert failed: ${routineErr?.message}`,
      );
      continue;
    }
    const routineId = (routine as { id: string }).id;

    // Insert the run row + fire the dispatcher. Drain executes async.
    const { data: run } = await db
      .from("rgaios_routine_runs")
      .insert({
        organization_id: orgId,
        routine_id: routineId,
        source: "chat_task",
        status: "pending",
        input_payload: {
          delegated_by_agent_id: speakerAgentId,
          title,
        },
      } as never)
      .select("id")
      .single();
    const runId = (run as { id: string } | null)?.id ?? null;
    if (runId) {
      try {
        dispatchRun(runId, orgId);
      } catch (err) {
        console.warn(
          `[tasks] dispatchRun failed for run ${runId}: ${(err as Error).message}`,
        );
      }
    }

    // Audit log so the activity feed picks it up.
    try {
      await db.from("rgaios_audit_log").insert({
        organization_id: orgId,
        kind: "task_created",
        actor_type: "agent",
        actor_id: speakerAgentId,
        detail: {
          agent_id: assignee.id,
          routine_id: routineId,
          run_id: runId,
          title,
          delegated_from: speakerAgentId,
        },
      } as never);
    } catch {}

    tasks.push({
      routineId,
      runId,
      title,
      assigneeAgentId: assignee.id,
      assigneeName: assignee.name,
    });
  }

  return { visibleReply, tasks };
}

import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchRun } from "@/lib/runs/dispatch";
import { registerTool, text, textError } from "../registry";

/**
 * agent_invoke  -  fire-and-relay. A manager persona calls this mid-
 * conversation to ask a sub-agent for something; the reply comes back
 * as a single text block the manager can weave into its own answer.
 *
 * Implementation note: in v3 this does NOT spawn a second Claude Code
 * subprocess. Instead it enqueues a routine run tagged with the target
 * agent and waits (with a cap) for the drain-server to complete it.
 * That reuses the existing runs pipeline and keeps concurrency bounded
 * by the 4-spawn cap.
 */

// Hard ceiling on delegation chain length, mirrored from the chat
// agent-commands surface. A -> B -> C -> D is depth 3 (three hops); a
// fourth hop is refused so re-delegation can't recurse unbounded.
const MAX_DELEGATION_DEPTH = 3;

/**
 * Best-effort discovery of the delegation chain that led to the CALLER
 * of this tool. The MCP ToolContext only carries organizationId +
 * userId - no run id, no input_payload - so the incoming chain is not
 * cleanly threadable. The reachable signal is the DB: find the most
 * recent delegation/agent_invoke run assigned to the caller and read
 * the delegation_chain we wrote onto its input_payload. Empty chain =>
 * the caller is not itself a delegated agent.
 */
async function loadIncomingChain(
  db: ReturnType<typeof supabaseAdmin>,
  orgId: string,
  callerAgentId: string,
): Promise<{ chain: string[]; depth: number }> {
  if (!callerAgentId) return { chain: [], depth: 0 };
  // DB-hiccup guard (D 04:22 dispatch): a single transient Supabase
  // 5xx / network blip used to fall straight through to the
  // depth=0 fallback, which silently RESET the delegation chain.
  // The downstream MAX_DELEGATION_DEPTH gate then allowed a fourth
  // hop because depth registered as 0 again. One single-shot retry
  // catches the common case (cold-start / transient pool churn)
  // without turning this into an unbounded retry loop that would
  // hold up the delegation. Both failures and the final fallback
  // log a clear warning so ops can see when the chain was lost.
  const query = async () =>
    db
      .from("rgaios_routine_runs")
      .select("input_payload, created_at, rgaios_routines!inner(assignee_agent_id)")
      .eq("organization_id", orgId)
      .eq("rgaios_routines.assignee_agent_id", callerAgentId)
      .in("source", ["chat_command", "agent_invoke"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { data } = await query();
      const ip = (data as { input_payload?: unknown } | null)?.input_payload;
      if (ip && typeof ip === "object" && !Array.isArray(ip)) {
        const o = ip as Record<string, unknown>;
        const chain = Array.isArray(o.delegation_chain)
          ? (o.delegation_chain as unknown[]).filter(
              (x): x is string => typeof x === "string",
            )
          : [];
        const depth =
          typeof o.delegation_depth === "number"
            ? o.delegation_depth
            : chain.length;
        return { chain, depth };
      }
      // No row found: caller is not itself a delegated agent. Normal
      // fall-through to depth=0, NOT a hiccup - skip the retry + skip
      // the depth-reset warning.
      return { chain: [], depth: 0 };
    } catch (err) {
      lastErr = err as Error;
      console.warn(
        `[agent-invoke] loadIncomingChain attempt ${attempt}/2 for caller ${callerAgentId} failed: ${lastErr.message}`,
      );
    }
  }
  // Reached only on two consecutive DB failures. The depth=0 reset
  // here would silently re-open the chain past MAX_DELEGATION_DEPTH
  // on the NEXT hop; log explicitly so a chain-reset on a real
  // delegated agent surfaces in logs instead of vanishing.
  console.warn(
    `[agent-invoke] loadIncomingChain returning depth=0 fallback for caller ${callerAgentId} after DB failures (${lastErr?.message ?? "unknown"}) - delegation depth tracking lost for this hop`,
  );
  return { chain: [], depth: 0 };
}

registerTool({
  name: "agent_invoke",
  description:
    "Delegate a task to another agent in this organization. The target " +
    "agent runs the task and returns a single text reply. Use when the " +
    "current manager persona needs a sub-agent's specialty (e.g., a " +
    "Copywriter's draft) mid-conversation. For a clean handoff, pass " +
    "output_format (the exact shape you want the reply in) and " +
    "constraints (boundaries: what to avoid, scope limits, tone) - a " +
    "well-scoped handoff gives a sharper sub-agent reply.",
  inputSchema: {
    type: "object",
    // No hard-required fields: the normal path needs agent_id+prompt, but
    // the poll-only collect path (poll_run_ids) takes neither. The handler
    // validates per-mode. Pedro 2026-05-19.
    required: [],
    properties: {
      agent_id: {
        type: "string",
        description: "Which agent to invoke (UUID).",
      },
      poll_run_ids: {
        type: "array",
        items: { type: "string" },
        description:
          "COLLECT MODE. Array of run_id strings returned by prior " +
          "wait:false dispatches. When set, this call ignores agent_id/" +
          "prompt, polls all those runs IN PARALLEL server-side, and " +
          "returns a JSON array of { run_id, status, output }. Use it " +
          "after a fan-out (4x agent_invoke with wait:false) to gather " +
          "every sub-agent result in ONE blocking call, then synthesise. " +
          "This is the collect leg of the async fan-out pattern - the " +
          "supabase_run_sql path does NOT work (it targets the agent's " +
          "own Supabase project, not the rawclaw control plane).",
      },
      prompt: {
        type: "string",
        description: "The task for the target agent, in plain English.",
      },
      output_format: {
        type: "string",
        description:
          "Optional. The exact output shape you expect back (e.g. " +
          "'3 bullet points', 'a JSON object with keys x,y', 'one " +
          "paragraph'). Appended to the task as a labelled block.",
      },
      constraints: {
        type: "string",
        description:
          "Optional. Boundaries for the sub-agent: what to avoid, " +
          "scope limits, tone, tools to prefer. Appended to the task " +
          "as a labelled block.",
      },
      context: {
        type: "string",
        description:
          "Optional. Free-form framing the sub-agent should have " +
          "before it starts: what was already tried, what the bigger " +
          "goal is, why this task matters. Threaded into the sub-agent's " +
          "prompt as a labelled context block.",
      },
      operator_ask: {
        type: "string",
        description:
          "Optional. The original operator question that kicked off " +
          "this delegation. Replayed to the sub-agent as the opening " +
          "user turn so it sees the conversation it is joining.",
      },
      wait: {
        type: "boolean",
        description:
          "Default true. When false, fire-and-forget mode: enqueue the run + return immediately with { run_id, status: 'dispatched' }. " +
          "Used by Scan for multi-agent fan-out so the SDK doesn't serialise stateful tool calls that all block on poll. " +
          "Caller must poll status separately (via supabase_run_sql on rgaios_routine_runs) once enough time has passed for sub-agents to finish.",
      },
      timeout_ms: {
        type: "number",
        description:
          "How long to wait for completion. Defaults to 180s (must be <300s wall-clock cap). " +
          "Pedro 2026-05-19: drain spawn + Claude CLI subprocess + MCP tool calls + " +
          "sub-agent synthesis routinely lands at 60-180s on InstaCEO Academy / Marti; " +
          "the older 90s default + 120s cap left the dispatcher reporting 'timed out' on " +
          "runs that completed minutes later in the background. Bumped to 180/300s so the " +
          "happy path lands inside the poll window. If sub-agents grow heavier later, prefer " +
          "switching to a notify-on-complete callback before pushing this cap higher (the " +
          "drain claim + Claude CLI cold-start cost a fixed ~30s overhead that's not worth " +
          "blocking the chat surface on).",
      },
    },
  },
  handler: async (args, ctx) => {
    // COLLECT MODE: poll a batch of already-dispatched runs in parallel
    // and return their outputs. This is the second leg of the async
    // fan-out pattern - Scan fires N agent_invoke(wait:false) in one turn
    // (truly concurrent because none block), then makes ONE collect call
    // with all the run_ids. We poll them all via Promise.all so the wall-
    // clock is the slowest single run, not the sum. Pedro 2026-05-19:
    // supabase_run_sql can't read the control plane (it targets the org's
    // own Supabase project), so this in-tool collect is the only reliable
    // readback path on the Telegram surface.
    if (Array.isArray(args.poll_run_ids) && args.poll_run_ids.length > 0) {
      const db = supabaseAdmin();
      const ids = args.poll_run_ids.map((x) => String(x)).filter(Boolean);
      // BOUNDED wait, not block-until-done. Pedro 2026-05-19: the MCP
      // transport between the Claude CLI subprocess and /api/mcp times
      // a single tool call out at ~60s, so a poll that blocks 2+ min
      // waiting for slow drain-spawned sub-agents gets killed mid-flight
      // and the caller sees a false "collect timed out". Instead we wait
      // a short window (~40s, safely under the transport cap), then
      // return PARTIAL results: succeeded/failed runs carry their output,
      // not-yet-finished runs come back status:"pending". The caller
      // (Scan) re-calls poll_run_ids with the still-pending ids - that's
      // a collect retry, NOT a re-dispatch, so it doesn't violate the
      // no-retry rule and never re-fires the sub-agents.
      const POLL_CAP_MS = 40_000;
      const deadline = Date.now() + POLL_CAP_MS;
      const results = await Promise.all(
        ids.map(async (id) => {
          while (true) {
            const { data } = await db
              .from("rgaios_routine_runs")
              .select("status, output, error")
              .eq("id", id)
              .eq("organization_id", ctx.organizationId)
              .maybeSingle();
            const row = data as
              | { status?: string; output?: { text?: string; summary?: string } | null; error?: string | null }
              | null;
            if (row?.status === "succeeded") {
              return {
                run_id: id,
                status: "succeeded",
                output: row.output?.text ?? row.output?.summary ?? null,
              };
            }
            if (row?.status === "failed") {
              return { run_id: id, status: "failed", error: row.error ?? null };
            }
            if (Date.now() >= deadline) {
              return { run_id: id, status: "pending" };
            }
            await new Promise((r) => setTimeout(r, 1500));
          }
        }),
      );
      const pending = results.filter((r) => r.status === "pending").length;
      const note =
        pending > 0
          ? `${pending} run(s) still pending - call poll_run_ids again with just the pending run_ids to finish collecting. This is a collect retry, not a re-dispatch.`
          : "all runs resolved";
      return text(JSON.stringify({ note, results }, null, 2));
    }

    const agentId = String(args.agent_id ?? "").trim();
    const basePrompt = String(args.prompt ?? "").trim();
    const outputFormat = String(args.output_format ?? "").trim();
    const constraints = String(args.constraints ?? "").trim();
    const context = String(args.context ?? "").trim();
    const operatorAsk = String(args.operator_ask ?? "").trim();
    // Force the floor: even if Scan's session cached an older description
    // that said "default 90s", we refuse to honor a too-short caller wait.
    // Sub-agent runs on Marti routinely land at 30-100s; a 90s ceiling
    // surfaced "did not complete" on runs that succeeded ~95s later, and
    // Scan reports those as honest timeouts to the operator. Clamp the
    // poll cap to [180s, 300s] regardless of what the caller passed.
    const timeoutMs = Math.min(
      Math.max(Number(args.timeout_ms ?? 180_000) || 180_000, 180_000),
      300_000,
    );
    if (!agentId || !basePrompt) {
      return textError("agent_id and prompt are required.");
    }
    // Structured handoff: objective first, then optional OUTPUT FORMAT /
    // CONSTRAINTS blocks. A call with only `prompt` produces exactly
    // basePrompt - fully backward compatible with existing callers.
    const prompt = [
      basePrompt,
      outputFormat ? `OUTPUT FORMAT: ${outputFormat}` : "",
      constraints ? `CONSTRAINTS: ${constraints}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const db = supabaseAdmin();

    const { data: target } = await db
      .from("rgaios_agents")
      .select("id, name, title")
      .eq("id", agentId)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (!target) return textError("Agent not found in this organization.");

    // Cycle + depth guard (GAP #18 / Marti client-acceptance.html PHASE-0).
    // PRE-FIX: this keyed the incoming-chain lookup off ctx.userId. But
    // loadIncomingChain joins through rgaios_routines on
    // assignee_agent_id - which is an AGENT id, never a user id. So
    // for every agent->agent invocation the lookup matched zero rows,
    // returned an empty chain, and the MAX_DELEGATION_DEPTH=3 cap
    // never fired. A runaway delegation chain could recurse without
    // limit (P0 abuse vector flagged in Marti client-acceptance.html
    // PHASE-0 pre-req).
    //
    // POST-FIX: key the lookup off ctx.agentId. ToolContext.agentId
    // (src/lib/mcp/types.ts:14) is populated by exactly the
    // in-process call paths that constitute an agent->agent
    // delegation chain: executor, execToolCall (chat speaker),
    // decideApproval (stored approval row). When agentId is null
    // (external bearer-token MCP client - not part of a delegation
    // chain by definition) loadIncomingChain short-circuits to an
    // empty chain so the call still proceeds.
    const incoming = await loadIncomingChain(
      db,
      ctx.organizationId,
      String(ctx.agentId ?? ""),
    );
    if (incoming.chain.includes(agentId)) {
      return textError(
        `agent_invoke refused - delegation cycle: ${target.name} is already in this chain.`,
      );
    }
    if (incoming.depth + 1 > MAX_DELEGATION_DEPTH) {
      return textError(
        `agent_invoke refused - delegation depth limit (${MAX_DELEGATION_DEPTH}) reached; chain is too long to fan out further.`,
      );
    }
    // Outgoing chain = incoming chain + this hop's target. We append the
    // target (the MCP surface can't supply a verified caller id) so the
    // assignee's own follow-up agent_invoke sees a chain that includes
    // it, and the cycle check above still fires on re-entry.
    const outgoingChain = [...incoming.chain, agentId];
    const outgoingDepth = outgoingChain.length;

    // Find-or-create an "ad-hoc invocation" routine for this agent. We use
    // one long-lived routine per agent so run history stays grouped in the
    // dashboard under a recognisable title.
    const INVOKE_ROUTINE_TITLE = `Direct invocation  -  ${target.name}`;

    const { data: routine } = await db
      .from("rgaios_routines")
      .select("id, status")
      .eq("organization_id", ctx.organizationId)
      .eq("assignee_agent_id", agentId)
      .eq("title", INVOKE_ROUTINE_TITLE)
      .maybeSingle();

    let routineId = (routine as { id?: string } | null)?.id ?? null;
    if (!routineId) {
      // kind='delegation': this is a delegation holder, not an automated
      // workflow - it has no trigger. Keeps it off the /routines list
      // (listRoutinesForOrg filters to kind='workflow'); run history is
      // still reachable via the Tasks tab / runs queries.
      const { data: created, error } = await db
        .from("rgaios_routines")
        .insert({
          organization_id: ctx.organizationId,
          title: INVOKE_ROUTINE_TITLE,
          description:
            "Auto-created by agent_invoke. Holds direct manager→sub-agent delegations so their run history stays grouped.",
          assignee_agent_id: agentId,
          status: "active",
          kind: "delegation",
        })
        .select("id")
        .single();
      if (error || !created) {
        return textError(`Could not create invocation routine: ${error?.message ?? "unknown"}`);
      }
      routineId = created.id;
    }

    // Enqueue the run. Beyond `prompt` (the composed task text), write
    // the structured handoff fields under the exact names
    // executeChatTask's extractTaskContext reads back - context,
    // constraints, output_format, operator_ask. The READ side
    // (committed a01566c) already threads these into the delegated
    // agent's prompt + history; this is the WRITE side that populates
    // them. constraints / output_format are also folded into `prompt`
    // above for models that ignore history, but writing them structured
    // lets the read side surface each as its own labelled section.
    const inputPayload: Record<string, unknown> = {
      prompt,
      invoked_by: "manager",
      // Delegation chain bookkeeping (see loadIncomingChain). Written
      // on every run so the depth/cycle guard has data to read when
      // the assignee later invokes another agent.
      delegation_depth: outgoingDepth,
      delegation_chain: outgoingChain,
    };
    if (context) inputPayload.context = context;
    if (constraints) inputPayload.constraints = constraints;
    if (outputFormat) inputPayload.output_format = outputFormat;
    if (operatorAsk) inputPayload.operator_ask = operatorAsk;
    const { data: run, error: runErr } = await db
      .from("rgaios_routine_runs")
      .insert({
        organization_id: ctx.organizationId,
        routine_id: routineId,
        source: "agent_invoke",
        status: "pending",
        input_payload: inputPayload,
      })
      .select("id")
      .single();
    if (runErr || !run) {
      return textError(`Could not enqueue invocation: ${runErr?.message ?? "unknown"}`);
    }

    // Trigger the executor / drain. Without this the run sits in
    // `pending` until the systemd-tick fallback catches it (1-2 min),
    // which always loses the race against the timeoutMs cap below.
    dispatchRun(run.id, ctx.organizationId);

    // Fire-and-forget mode (Pedro 2026-05-19): Claude Code SDK
    // serialises stateful tool calls when each one blocks on a poll, so
    // a 4-agent fan-out runs serially even when the operator named them
    // all together. wait:false returns immediately with the run_id; the
    // caller (Scan) emits 4 of these in one assistant turn = SDK happily
    // fires them concurrently, drain processes them in parallel (4-slot
    // concurrency), and Scan polls them all via supabase_run_sql on
    // rgaios_routine_runs in the next turn for a true parallel synthesis.
    // Default ASYNC. Only block-and-poll when caller explicitly opts in
    // with `wait: true`. Reason (Pedro 2026-05-19 second deadline pass):
    // Claude Code SDK serialises stateful tool calls that block — even
    // when the model emits 4 agent_invoke tool_use blocks in parallel,
    // each one blocks the next at SDK level, so a 4-agent fan-out runs
    // serially (4× the latency). Returning instantly by default lets
    // the SDK dispatch all 4 truly concurrent + drain handle them with
    // 4-slot concurrency. Callers that want blocking semantics (one-off
    // sequential invocations) pass `wait: true` explicitly.
    if (args.wait !== true) {
      return text(
        JSON.stringify({
          run_id: run.id,
          status: "dispatched",
          note: `Fire-and-forget. Poll via SELECT status, output FROM rgaios_routine_runs WHERE id = '${run.id}' once the sub-agent has had ~60-90s to land.`,
        }),
      );
    }

    // Poll for completion with a hard wall-clock cap.
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1500));
      const { data: current } = await db
        .from("rgaios_routine_runs")
        .select("status, output, error")
        .eq("id", run.id)
        .maybeSingle();
      if (!current) break;
      if (current.status === "succeeded") {
        // Sub-agent run output schema is { text, source } (see executor +
        // chat-task return shape). The older `.summary` key was a planned
        // shape that never landed; reading it alone returned undefined on
        // every successful run, which the dispatcher then surfaced as
        // "Sub-agent completed but returned no summary" - operator + Scan
        // both saw it as an empty/failed delegation even though the real
        // deliverable was sitting in `output.text`. Fall back to `.text`
        // before declaring empty so the actual result reaches synthesis.
        // Pedro 2026-05-19: caught on Marti while watching 8 succeeded
        // runs report empty to Scan.
        const outBlob = current.output as
          | { summary?: string; text?: string }
          | null;
        const output = outBlob?.summary ?? outBlob?.text;
        return text(
          output ?? "Sub-agent completed but returned no summary.",
        );
      }
      if (current.status === "failed") {
        return textError(`Sub-agent failed: ${current.error ?? "unknown error"}`);
      }
    }

    return textError(
      `Sub-agent did not complete within ${Math.round(timeoutMs / 1000)}s. Check the activity feed for progress.`,
    );
  },
});

export const AGENT_INVOKE_TOOL_REGISTERED = true;

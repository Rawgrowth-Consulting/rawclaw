import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

import { getOrgContext, getActiveOrgRole } from "@/lib/auth/admin";
import { isDepartmentAllowed } from "@/lib/auth/dept-acl";
import { supabaseAdmin } from "@/lib/supabase/server";
import { chatReply } from "@/lib/agent/chat";
import { extractChatMemoryFact } from "@/lib/agent/chat-memory";
import { applyBrandFilter } from "@/lib/brand/apply-filter";
import {
  buildAgentChatPreambleV2,
  computeChatBudget,
} from "@/lib/agent/context";
import { persistChatTelemetry } from "@/lib/agent/telemetry";
import { extractAndCreateTasks } from "@/lib/agent/tasks";
import { extractAndExecuteCommands } from "@/lib/agent/agent-commands";
import { stripBareJsonCommands } from "@/lib/agent/markup";
import { extractThinking, extractThinkingRaw, humanizeJargon } from "@/lib/agent/thinking";
import { persistSharedMemoryFromReply } from "@/lib/memory/shared";
import { badUuidResponse } from "@/lib/utils";

/**
 * Generate a chain-of-thought "thinking" brief for the operator. Two-tier:
 *
 *   - Haiku-based (preferred, when ANTHROPIC_API_KEY is set): one short
 *     sentence summarising the agent's plan. Tiny, sub-second, doesn't
 *     touch the OAuth pool that powers the main reply.
 *   - Heuristic fallback (when no API key): classify the user message by
 *     verb + intent and emit a templated brief. Less smart, but always
 *     fires so the operator sees SOMETHING above each reply.
 *
 * Best-effort: any failure returns null and the chat reply proceeds.
 */
async function generateThinkingBrief(userMessage: string): Promise<string | null> {
  if (!userMessage || userMessage.length < 3) return null;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const result = await generateText({
        model: anthropic("claude-haiku-4-5"),
        system:
          "You are summarising what an AI agent is about to do, before it answers. Reply with one short sentence under 100 characters starting with 'I will'. No quotes, no preamble. Be concrete.",
        prompt: `User message: ${userMessage.slice(0, 400)}`,
        abortSignal: ctrl.signal,
      });
      clearTimeout(timer);
      const brief = result.text.trim().replace(/^["']|["']$/g, "").slice(0, 140);
      if (brief) return brief;
    } catch {
      // fall through to heuristic
    }
  }
  // Heuristic fallback - works on every VPS regardless of API key
  // configuration (Marti runs RUNTIME_PATH=cli with no ANTHROPIC_API_KEY,
  // so this path is its ONLY brief). Strip a leading greeting/filler
  // FIRST so "hey, can you pull my best post" classifies on the real
  // ask, not on the word "hey" - the old regex matched the greeting and
  // emitted "stand by for the real ask" even when the real ask was
  // right there in the same sentence.
  const stripped = userMessage
    .trim()
    .replace(/^(hi+|hello|hey+|yo|oi+|ol[aá]|cze[sś][cć]|hej|e a[ií])[\s,!.…-]+/i, "")
    .trim();
  const t = stripped.toLowerCase();
  // Only a BARE greeting (nothing substantive left after the strip) is a
  // greeting turn.
  if (t.length < 4) {
    return "I will greet the operator and ask what they actually need.";
  }
  if (/^(agent_invoke|dispatch|delegate|ask)\s+/i.test(stripped)) {
    const m = stripped.match(/(?:agent_invoke|dispatch|delegate|ask)\s+(\w+)/i);
    const tgt = m?.[1] ?? "the right dept head";
    return `I will delegate to ${tgt} and surface the result inline.`;
  }
  if (/\b(instagram|\big\b|posts?|reels?|apify|scrape|engagement|best post|martifox)\b/i.test(t)) {
    return "I will pull the Instagram numbers and work from the real data.";
  }
  if (/composio|gmail|slack|calendar|google|hubspot|\btool\b/i.test(t)) {
    return "I will check what's connected and use the right one.";
  }
  if (/council|debate|both .* and|marketing and|cross-functional/i.test(t)) {
    return "I will convene a council - dispatch the relevant heads, then synthesise their angles into a decision.";
  }
  if (/(?:^bye|tchau|see you|^thanks|^obrigad)/i.test(t)) {
    return "I will close the turn briefly without spinning up new work.";
  }
  if (/(?:status|progress|stuck|monitor|what.*pending)/i.test(t)) {
    return "I will status-check open delegations and surface anything stuck.";
  }
  if (/^(write|draft|plan|create|make|build|outline|review|audit)\b/i.test(t)) {
    return "I will produce this directly, grounded in org context and brand voice.";
  }
  if (/^(list|show|what|how|why|when|where|who|can you|could you|qual|quem|onde|porque|como)/i.test(t)) {
    return "I will answer directly from org context (RAG / memory + tools), no delegation unless it needs a dept.";
  }
  return "I will work the ask in the operator's language, delegating only if it genuinely fits one department.";
}

export const runtime = "nodejs";

const HISTORY_LIMIT = 50;
const SURFACE = "agent_chat";

const HARD_FAIL_MESSAGE =
  "[brand voice guard] Reply withheld - copy still contained banned words after one regeneration. An operator needs to review.";

type IncomingMessage = { role: string; content: string };

type SecretHit = { kind: string; fragment: string };

/**
 * Scrub secrets pasted into chat (API keys, bearer tokens, SSH
 * creds, PEM blocks, AWS keys). Applied to BOTH inbound user text
 * and outbound agent reply so secrets never persist to
 * rgaios_agent_chat_messages or get embedded into
 * rgaios_company_chunks. Caller logs hit kinds (not fragments) and
 * surfaces an SSE warning to the operator.
 */
function redactSecrets(text: string): {
  redacted: string;
  hits: SecretHit[];
} {
  const hits: SecretHit[] = [];
  const patterns: Array<{
    kind: string;
    re: RegExp;
    replacement: string;
  }> = [
    {
      kind: "pem_private_key",
      re: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
      replacement: "[REDACTED PRIVATE KEY]",
    },
    {
      kind: "anthropic_api_key",
      re: /sk-ant-[A-Za-z0-9_-]{20,}/g,
      replacement: "[REDACTED]",
    },
    {
      kind: "aws_access_key",
      re: /AKIA[0-9A-Z]{16}/g,
      replacement: "[REDACTED AWS KEY]",
    },
    {
      kind: "root_at_ip_password",
      re: /root@\d{1,3}(?:\.\d{1,3}){3}.{0,40}password\s*[:=]\s*\S+/gi,
      replacement: "root@x.x.x.x password: [REDACTED]",
    },
    {
      kind: "bearer_token",
      re: /[Bb]earer\s+[A-Za-z0-9_.\-]{20,}/g,
      replacement: "Bearer [REDACTED]",
    },
    {
      kind: "api_key_prefix",
      re: /(sk|ak|pk|ck|sk_live|pk_live|sk_test|sk-proj|ghp|gho|gha|glpat|xoxb|xoxp|xoxa)[-_][A-Za-z0-9_-]{16,}/g,
      replacement: "[REDACTED API KEY]",
    },
    {
      // Supabase's 2026 key format: sb_secret_... (service role) and
      // sb_publishable_... (anon). The prefix family above does not
      // cover the `sb_` prefix, so a pasted Supabase service key would
      // have leaked into chat history + the company corpus.
      kind: "supabase_key",
      re: /sb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}/g,
      replacement: "[REDACTED SUPABASE KEY]",
    },
    {
      // Catch the truncated/ellipsis form agents tend to echo back in
      // warnings: `ak_gHrg9Sor...`. Lower length floor (4+ chars after
      // prefix) and trailing ellipsis or dots. Runs after the full-key
      // pattern so the longer-match-first ordering still holds.
      kind: "api_key_prefix_truncated",
      re: /(sk|ak|pk|ck|sk_live|pk_live|sk_test|sk-proj|ghp|gho|gha|glpat|xoxb|xoxp|xoxa)[-_][A-Za-z0-9_-]{4,}\.{2,}/g,
      replacement: "[REDACTED API KEY]",
    },
    {
      kind: "password_phrase",
      re: /(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,
      replacement: "password: [REDACTED]",
    },
  ];
  let redacted = text;
  for (const p of patterns) {
    redacted = redacted.replace(p.re, (match) => {
      const frag =
        match.length > 12
          ? `${match.slice(0, 4)}...${match.slice(-4)}`
          : "***";
      hits.push({ kind: p.kind, fragment: frag });
      return p.replacement;
    });
  }
  return { redacted, hits };
}

/**
 * Insight chat queue (paired with /api/insights/[id]/open-chat).
 *
 * Called immediately after a user message lands in Atlas chat. If the
 * agent receiving the message is Atlas (CEO) and an insight is in
 * chat_state='sent', mark it answered and promote the oldest queued
 * insight - seed its question as a fresh assistant turn so the
 * conversation continues without operator action.
 */
async function maybePromoteInsightQueue(orgId: string, agentId: string) {
  const db = supabaseAdmin();
  // Defense-in-depth: caller already org-scoped the agent at POST entry,
  // but this helper is internal-callable, so add the explicit filter
  // here too. Cheap and avoids an orphaned insight promotion if the
  // call site ever drifts.
  const { data: agent, error: agentErr } = await db
    .from("rgaios_agents")
    .select("role")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (agentErr) {
    console.error("[chat] insight-queue agent lookup failed:", agentErr.message);
    throw new Error(agentErr.message);
  }
  if ((agent as unknown as { role?: string } | null)?.role !== "ceo") return;

  const now = new Date().toISOString();

  // Mark all currently-sent insights as answered. There should only be
  // one but be tolerant of pre-existing dupes.
  const sentUpdate = await db
    .from("rgaios_insights")
    .update({ chat_state: "answered", chat_state_updated_at: now } as never)
    .eq("organization_id", orgId)
    .eq("chat_state", "sent");
  if (sentUpdate.error) {
    console.error(
      "[chat] insight-queue answered-update failed:",
      sentUpdate.error.message,
    );
    throw new Error(sentUpdate.error.message);
  }

  // Pick the oldest queued insight to promote.
  const { data: nextRow, error: nextErr } = await db
    .from("rgaios_insights")
    .select("id, title, suggested_action, reason")
    .eq("organization_id", orgId)
    .eq("chat_state", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (nextErr) {
    console.error(
      "[chat] insight-queue next-row select failed:",
      nextErr.message,
    );
    throw new Error(nextErr.message);
  }

  if (!nextRow) return;
  type Row = {
    id: string;
    title: string;
    suggested_action: string | null;
    reason: string | null;
  };
  const next = nextRow as unknown as Row;

  const parts = [`**${next.title}**`];
  if (next.reason) parts.push(next.reason);
  if (next.suggested_action) parts.push(next.suggested_action);
  const content = parts.join("\n\n");

  const seedInsert = await db.from("rgaios_agent_chat_messages").insert({
    organization_id: orgId,
    agent_id: agentId,
    user_id: null,
    role: "assistant",
    content,
    metadata: { source: "insight", insight_id: next.id, promoted: true },
  } as never);
  if (seedInsert.error) {
    console.error(
      "[chat] insight-queue seed-insert failed:",
      seedInsert.error.message,
    );
    throw new Error(seedInsert.error.message);
  }

  const promoteUpdate = await db
    .from("rgaios_insights")
    .update({ chat_state: "sent", chat_state_updated_at: now } as never)
    .eq("id", next.id);
  if (promoteUpdate.error) {
    console.error(
      "[chat] insight-queue promote-update failed:",
      promoteUpdate.error.message,
    );
    throw new Error(promoteUpdate.error.message);
  }
}

// Proactive-thread classification. The agent writes unprompted rows
// into the SAME rgaios_agent_chat_messages table as the operator
// conversation:
//   - the atlas-coordinate cron → metadata.kind = "atlas_coordinate"
//   - the insights generator   → metadata.kind = "proactive_anomaly"
// Rendering those inline made the operator's thread noisy ("fica
// confundindo a conversa"). They now live in a SEPARATE interactive
// thread. A row belongs to the proactive thread when EITHER its
// metadata.kind is one of those proactive kinds OR it was explicitly
// tagged metadata.thread = "proactive" (operator turns + the CEO's
// replies sent from the proactive view). Everything else is the main
// operator thread.
const PROACTIVE_KINDS = new Set(["atlas_coordinate", "proactive_anomaly"]);

function isProactiveRow(row: {
  metadata?: Record<string, unknown> | null;
}): boolean {
  const meta = row.metadata ?? {};
  const kind = typeof meta.kind === "string" ? meta.kind : "";
  if (PROACTIVE_KINDS.has(kind)) return true;
  return meta.thread === "proactive";
}

/**
 * GET /api/agents/[id]/chat
 *
 * Returns the last HISTORY_LIMIT messages for this agent (oldest first
 * so the client can render top-to-bottom without flipping). Used to
 * hydrate AgentChatTab on first mount so refreshing the panel keeps
 * the conversation visible.
 *
 * The read is SPLIT into two threads (see isProactiveRow): the main
 * operator conversation is returned as `messages`, and the proactive
 * thread (cron / insight rows + anything the operator and CEO said in
 * the proactive view) is returned as a separate `proactiveMessages`
 * array of the same row shape. The archived filter applies to both.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const { id: agentId } = await params;
  const bad = badUuidResponse(agentId);
  if (bad) return bad;
  const db = supabaseAdmin();

  // Cross-tenant guard.
  const { data: agent } = await db
    .from("rgaios_agents")
    .select("id")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // include=archived → return archived messages too (for history viewer)
  const includeArchived = new URL(_req.url).searchParams.get("include") === "archived";
  let q = db
    .from("rgaios_agent_chat_messages")
    .select("id, role, content, created_at, metadata")
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(includeArchived ? 200 : HISTORY_LIMIT);
  if (!includeArchived) {
    q = q.or("metadata->>archived.is.null,metadata->>archived.eq.false");
  }
  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Oldest-first so the client renders top-to-bottom. Then split the
  // two threads: proactive rows (cron / insight + thread-tagged) go to
  // `proactiveMessages`, everything else stays in `messages`.
  const ordered = [...(data ?? [])].reverse() as Array<{
    id: string;
    role: string;
    content: string;
    created_at: string;
    metadata: Record<string, unknown> | null;
  }>;
  const messages = ordered.filter((r) => !isProactiveRow(r));
  const proactiveMessages = ordered.filter((r) => isProactiveRow(r));
  return NextResponse.json({ messages, proactiveMessages });
}

/**
 * DELETE /api/agents/[id]/chat
 * "New chat" - soft-archives the current visible thread by tagging
 * each message with metadata.archived = true + an archived_at stamp.
 * The GET handler filters those out so the tab starts fresh, but the
 * raw history is still in rgaios_agent_chat_messages and can be
 * restored / surfaced later. Memory tab + extracted chat_memory rows
 * are untouched.
 *
 * Per-thread: `?thread=proactive` archives ONLY the proactive thread
 * (cron / insight rows + thread-tagged turns); the default archives
 * ONLY the main operator thread. Starting a fresh main chat must not
 * wipe the proactive feed and vice versa.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const { id: agentId } = await params;
  const bad = badUuidResponse(agentId);
  if (bad) return bad;
  const db = supabaseAdmin();

  const { data: agent } = await db
    .from("rgaios_agents")
    .select("id")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Pull current (non-archived) messages, merge archive flag into their
  // metadata, write back. metadata is jsonb so we can carry an archive
  // marker without a schema migration. Parallelize the per-row updates -
  // sequential awaits made "+ New chat" lag noticeably with 30+ messages.
  const thread =
    new URL(_req.url).searchParams.get("thread") === "proactive"
      ? "proactive"
      : "main";
  const { data: rows } = await db
    .from("rgaios_agent_chat_messages")
    .select("id, metadata")
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .or("metadata->>archived.is.null,metadata->>archived.eq.false");
  const stamp = new Date().toISOString();
  // Only archive rows in the requested thread - main "+ New chat" must
  // not nuke the proactive feed, and vice versa.
  const typedRows = (
    (rows ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null }>
  ).filter((r) =>
    thread === "proactive" ? isProactiveRow(r) : !isProactiveRow(r),
  );
  const settled = await Promise.all(
    typedRows.map(async (r): Promise<{ id: string; ok: boolean; error?: string }> => {
      const next = { ...(r.metadata ?? {}), archived: true, archived_at: stamp };
      const res = await db
        .from("rgaios_agent_chat_messages")
        .update({ metadata: next } as never)
        .eq("id", r.id);
      if (res.error) {
        return { id: r.id, ok: false, error: res.error.message };
      }
      return { id: r.id, ok: true };
    }),
  );
  const failed = settled.filter((s) => !s.ok);
  if (failed.length > 0) {
    console.error(
      "[chat] DELETE archive partial failure:",
      failed.map((f) => `${f.id}:${f.error}`).join(", "),
    );
    const archived = settled.length - failed.length;
    const status = archived > 0 ? 207 : 500;
    return NextResponse.json(
      {
        ok: false,
        archived,
        failed: failed.map((f) => ({ id: f.id, error: f.error })),
      },
      { status },
    );
  }
  return NextResponse.json({ ok: true, archived: typedRows.length });
}

/**
 * POST /api/agents/[id]/chat
 *
 * Accepts { messages: [{role, content}, ...] }. Last entry is the new
 * user message. Streams an SSE-style newline-delimited JSON event
 * stream back to the client:
 *   { type: "text", delta: string }   - one or more times as tokens land
 *   { type: "done" }                  - end-of-stream marker
 *   { type: "error", message: string} - terminal failure
 *
 * On the server side:
 *   1. Insert the user message.
 *   2. Build persona context (role + title + system_prompt fallback to
 *      description). Pull top-K agent-file chunks via the same RPC the
 *      MCP knowledge_query tool uses; prepend them as "Relevant context".
 *   3. Call chatReply() with our own history + extraPreamble.
 *   4. Run applyBrandFilter on the assistant text. Hard-fail replaces
 *      the visible reply with the operator-warning string but the audit
 *      row + DB persistence still happen.
 *   5. Insert the assistant reply, emit the final delta + {type:"done"}.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const userId = ctx.userId;
  const { id: agentId } = await params;
  const bad = badUuidResponse(agentId);
  if (bad) return bad;
  const db = supabaseAdmin();

  // Cross-tenant guard. Persona + RAG happen inside buildAgentChatPreamble.
  // max_tokens is the per-agent reasoning budget (migration 0074); null
  // means "use chatReply's DEFAULT_MAX_TOKENS".
  const { data: agent } = await db
    .from("rgaios_agents")
    .select("id, department, max_tokens")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  // Per-agent max_tokens override. When null we pass nothing so chatReply
  // falls back to its own DEFAULT_MAX_TOKENS.
  const agentMaxTokens =
    (agent as { max_tokens: number | null }).max_tokens ?? undefined;
  // Per-dept ACL. Marketing-only invitee can't POST chat to a sales
  // agent even if they guess the id.
  const allowed = await isDepartmentAllowed(
    {
      userId,
      organizationId: orgId,
      isAdmin: ctx.isAdmin,
    },
    (agent as { department: string | null }).department,
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { messages?: IncomingMessage[]; thread?: string };
  try {
    body = (await req.json()) as {
      messages?: IncomingMessage[];
      thread?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // Which thread this turn belongs to. "proactive" turns (operator
  // replies sent from the Proactive (CEO) view) + their resulting
  // assistant reply + every system row written for the turn get
  // tagged metadata.thread = "proactive" so GET groups them into the
  // proactive feed. The reply pipeline (preamble / memory / RAG) is
  // IDENTICAL either way - only the persistence tag differs.
  const thread = body.thread === "proactive" ? "proactive" : "main";
  // Merge the thread tag into any metadata object we persist this
  // turn. For the main thread it's a no-op (untagged = main) so we
  // keep rows lean.
  const withThread = <T extends Record<string, unknown>>(meta: T): T =>
    thread === "proactive" ? ({ ...meta, thread } as T) : meta;
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const userTurns = incoming.filter(
    (m): m is { role: "user" | "assistant"; content: string } =>
      (m?.role === "user" || m?.role === "assistant") &&
      typeof m?.content === "string" &&
      m.content.trim().length > 0,
  );
  const last = userTurns[userTurns.length - 1];
  if (!last || last.role !== "user") {
    return NextResponse.json(
      { error: "Last message must be from the user." },
      { status: 400 },
    );
  }
  // Cap the user turn at 20kb (matches the mini-saas / invites caps).
  // A multi-megabyte body would balloon the supabase row, the LLM
  // preamble, and the brand-filter regex pass.
  const rawLastContent = last.content.slice(0, 20_000);

  // Inbound secret scrub. Operators have pasted live Composio /
  // Anthropic / VPS-root creds into agent chat. Redact before
  // persistence + LLM forward so secrets never land in
  // rgaios_agent_chat_messages, never get embedded into
  // rgaios_company_chunks, and never echo back across agent memory.
  const inboundScrub = redactSecrets(rawLastContent);
  const lastContent = inboundScrub.redacted;
  const inboundHits = inboundScrub.hits;
  if (inboundHits.length > 0) {
    console.warn(
      "[chat] inbound secret_redacted:",
      JSON.stringify({
        org_id: orgId,
        agent_id: agentId,
        kinds: inboundHits.map((h) => h.kind),
      }),
    );
  }

  // 1. Persist. supabase returns errors as values - without the check
  // the user message silently drops, chatReply still burns an LLM call,
  // and a reload shows an empty thread.
  const userInsert = await db
    .from("rgaios_agent_chat_messages")
    .insert({
      organization_id: orgId,
      agent_id: agentId,
      user_id: userId,
      role: "user",
      content: lastContent,
      ...(thread === "proactive"
        ? { metadata: { thread } }
        : {}),
    } as never);
  if (userInsert.error) {
    console.error("[chat] user insert failed:", userInsert.error.message);
    return NextResponse.json(
      { error: "Failed to save your message. Please try again." },
      { status: 500 },
    );
  }

  // 1a. Insight chat queue: when the user replies in Atlas chat AND
  // there's a "sent" insight question awaiting a reply, mark it
  // answered, then promote the next queued insight (if any) to "sent"
  // and seed its question as the assistant's next turn. Keeps
  // insight-driven questions sequenced one-at-a-time per Pedro's rule.
  try {
    await maybePromoteInsightQueue(orgId, agentId);
  } catch (err) {
    console.warn(
      "[chat] insight-queue promotion failed:",
      (err as Error).message,
    );
  }

  // History for chatReply = everything BEFORE the latest user turn.
  // chatReply re-appends the latest user turn itself wrapped with the
  // persona preamble, so we must not include it twice.
  const history = userTurns.slice(0, -1).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // 1b. Passive tool-result recall. The active two-pass path only
  // re-feeds tool/command payloads when a <command> block ran THIS
  // turn. So if the operator pulls emails on turn 1 then asks "what did
  // the 2nd email say?" on turn 2 - no new command - the agent only
  // sees its own short prior reply text, not the data. Fix: pull the
  // last few persisted `chat_commands_executed` rows for this agent and
  // fold a compact digest of their results into the preamble as a
  // read-only "RECENT TOOL RESULTS" block. This does NOT touch the
  // active two-pass path - it's grounding context only, capped tight so
  // it can't balloon the preamble.
  let recallBlock = "";
  try {
    const { data: recallRows } = await db
      .from("rgaios_agent_chat_messages")
      .select("metadata, created_at")
      .eq("organization_id", orgId)
      .eq("agent_id", agentId)
      .eq("metadata->>kind", "chat_commands_executed")
      .or("metadata->>archived.is.null,metadata->>archived.eq.false")
      .order("created_at", { ascending: false })
      .limit(5);
    type RecallResult = {
      ok?: boolean;
      type?: string;
      summary?: string;
      detail?: Record<string, unknown> | null;
    };
    const RECALL_CAP = 3000;
    const PER_RESULT_CAP = 600;
    const lines: string[] = [];
    // Oldest-first so the digest reads chronologically.
    for (const row of [...(recallRows ?? [])].reverse()) {
      const meta = (row as { metadata: Record<string, unknown> | null })
        .metadata;
      const results = Array.isArray(meta?.results)
        ? (meta!.results as RecallResult[])
        : [];
      // HOTFIX H-ARCH-3 REVERT of H-ARCH-1 CHANGE 3 (per B 02:51):
      // The recall block previously redacted lookup_my_files /
      // list_knowledge_files / list_files / list_dir results to
      // "[file listing redacted]". That blinded the model from
      // recognising real filenames it had attached (v8-v10 model
      // told operator "I don't have creator-list" when the file
      // WAS attached - misleading reply). Operator-visible scrub
      // already happens at the SSE emit gateway (H-ARCH-1 CHANGE 1)
      // so the recall block can safely keep canonical filenames.
      for (const r of results) {
        const d = r.detail ?? {};
        let payload: string;
        if (
          typeof d.delegated_output === "string" &&
          d.delegated_output
        ) {
          payload = d.delegated_output;
        } else if (
          typeof d.result_preview === "string" &&
          d.result_preview
        ) {
          payload = `${r.summary ?? ""}\n${d.result_preview}`.trim();
        } else {
          payload = r.summary ?? "";
        }
        const type = r.type ?? "command";
        const status = r.ok === false ? " (failed)" : "";
        const entry = `- ${type}${status}: ${payload}`.slice(
          0,
          PER_RESULT_CAP,
        );
        if (entry.trim().length > 2) lines.push(entry);
      }
    }
    if (lines.length > 0) {
      let body = lines.join("\n");
      if (body.length > RECALL_CAP) {
        body = body.slice(0, RECALL_CAP) + "\n[...truncated]";
      }
      recallBlock =
        "\n\n═══ RECENT TOOL RESULTS IN THIS THREAD ═══\n" +
        "Tool calls / delegations you ran on EARLIER turns and their results. " +
        "Use this to answer follow-up questions about that data (\"what did the 2nd email say?\") " +
        "without re-running anything. This is recall context only - do NOT emit new <command> blocks just to re-fetch it.\n\n" +
        body;
    }
  } catch (err) {
    console.warn(
      "[chat] tool-result recall load failed:",
      (err as Error).message,
    );
  }

  // 2. Build the full preamble (persona + org place + memories + brand
  // + RAG over agent files + company corpus). Helper is shared with the
  // per-agent Telegram webhook so both surfaces see the same grounding.
  // FLEX MODE (Chris feedback 2026-05-17): thread the operator's role
  // through so the preamble can swap third-person ("the client") for
  // second-person ("your brand profile") when owner/admin is talking.
  // Anonymous + member surfaces (legacy seed users without a membership
  // row, scheduled routine runs) get the original client-facing tone.
  const userRole = await getActiveOrgRole(ctx);
  // Phase 2 selector: heavy threads (>20 incoming messages) lose budget
  // for the skippable preamble blocks (memory / signals / skills /
  // pending-tasks / past-mem / recent-reasoning / RAG / files). Required
  // blocks (persona, brand, json commands, trailing protocols) always
  // render so identity + tool protocol stay intact.
  //
  // Iter 36 + iter 41: base budget is role-aware (ROLE_BASED_BUDGET_POLICY)
  // scaled by the chat-history factor (chatHistoryBudgetFactor) so long
  // threads tighten the cap proportionally. Both pieces read from
  // budget-policy.config.json so ops can retune without code edits.
  const messageCount = incoming.length;
  const extraPreamble =
    (await buildAgentChatPreambleV2(
      {
        orgId,
        agentId,
        orgName: ctx.activeOrgName,
        queryText: lastContent,
        userRole,
      },
      {
        budgetPolicy: (flags) => computeChatBudget(flags, messageCount),
        telemetry: persistChatTelemetry({ orgId, agentId, messageCount }),
      },
    )) + recallBlock;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // HOTFIX H-ARCH-1 (2026-05-17, B 02:04 SSE-gateway spec):
      // single operator-facing chokepoint. Every SSE event leaving
      // this stream passes through humanizeJargon on its operator-
      // visible string fields. Prior approach humanized at each
      // emit call site - new render surfaces (reasoning chip,
      // spinner verb, tool labels) kept leaking raw tool names
      // and protocol jargon (v4/v5/v6 R-MARTI-CANONICAL walks).
      // Centralising guarantees: any future emit() automatically
      // inherits the operator-clean transform.
      const OPERATOR_FACING_TYPES = new Set([
        "text",
        "thinking",
        "command_running",
        "error",
        "commands_executed",
      ]);
      const OPERATOR_FACING_STRING_FIELDS = [
        "delta",
        "brief",
        "verb",
        "label",
        "message",
      ];
      const emit = (event: Record<string, unknown>) => {
        if (OPERATOR_FACING_TYPES.has(event.type as string)) {
          for (const k of OPERATOR_FACING_STRING_FIELDS) {
            const v = event[k];
            if (typeof v === "string" && v.length > 0) {
              event[k] = humanizeJargon(v);
            }
          }
          if (event.type === "commands_executed" && Array.isArray(event.results)) {
            event.results = (event.results as Array<Record<string, unknown>>).map(
              (r) => {
                const next: Record<string, unknown> = { ...r };
                if (typeof next.summary === "string") {
                  next.summary = humanizeJargon(next.summary as string);
                }
                return next;
              },
            );
          }
        }
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        // Surface inbound redactions to the operator BEFORE the reply
        // streams. Kinds only - fragments stay server-side.
        if (inboundHits.length > 0) {
          emit({
            type: "secret_redacted",
            hits: inboundHits.map((h) => h.kind),
            redactedText: lastContent,
          });
        }

        // 3. Generate the reply. chatReply is non-streaming today (Anthropic
        // OAuth + the Claude Code beta gate don't expose SSE alongside the
        // current beta header), so we emit the brand-filtered text as a
        // single delta. Wire shape stays {type:"text",delta} so the client
        // doesn't care whether tokens land one-by-one or in one chunk -
        // both render identically through the same accumulator.
        const result = await chatReply({
          organizationId: orgId,
          organizationName: ctx.activeOrgName,
          chatId: 0,
          userMessage: lastContent,
          publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
          agentId,
          historyOverride: history,
          extraPreamble,
          // Dashboard chat has no MCP tool drain - swap "always handoff"
          // for "answer from injected context" in the persona preamble.
          noHandoff: true,
          // Per-agent reasoning budget (migration 0074). undefined when
          // the agent has no override - chatReply uses DEFAULT_MAX_TOKENS.
          maxTokens: agentMaxTokens,
          // Pool rotation: try caller's own claude-max bucket before
          // borrowing other org members' buckets on 429.
          callerUserId: userId,
        });

        if (!result.ok) {
          emit({ type: "error", message: result.error });
          // Persist the error as a system row so the operator can see what
          // happened in the audit feed even if the client navigated away.
          await db.from("rgaios_agent_chat_messages").insert({
            organization_id: orgId,
            agent_id: agentId,
            user_id: null,
            role: "system",
            content: result.error,
            metadata: withThread({ kind: "chat_reply_failed" }),
          } as never);
          // Also log to audit_log so the connections page health probe
          // can detect a stale Claude Max token without burning a real
          // /v1/messages call on every page load.
          try {
            await db.from("rgaios_audit_log").insert({
              organization_id: orgId,
              kind: "chat_reply_failed",
              actor_type: "agent",
              actor_id: agentId,
              detail: { error: result.error, agent_id: agentId },
            } as never);
          } catch {}
          emit({ type: "done" });
          controller.close();
          return;
        }

        // 3b. Reasoning trace. The agent opens its reply with a
        // <thinking> block (REASONING PROTOCOL in preamble.ts) - the
        // ReAct "Thought" step, its real plan for this turn. Pull it
        // out FIRST so the raw XML never reaches the operator, surface
        // it as a `thinking` event + persist a system row + audit row
        // so /trace shows it. If the model didn't emit a block (older
        // persona, terse turn), fall back to the heuristic brief so the
        // operator still sees SOMETHING above the reply.
        // HOTFIX 30: use the RAW extract so the persisted-to-DB reply
        // keeps canonical tool names; humanize only at emit/render
        // boundary (line 1432 SSE + tool-card label paths) so the
        // operator surface stays clean. See thinking.ts comment.
        const extractedThinking = extractThinkingRaw(result.reply);
        const replyBody = extractedThinking.visibleReply;
        try {
          const brief =
            extractedThinking.thinking ??
            (await generateThinkingBrief(lastContent));
          if (brief) {
            emit({ type: "thinking", brief });
            await db.from("rgaios_agent_chat_messages").insert({
              organization_id: orgId,
              agent_id: agentId,
              user_id: null,
              role: "system",
              content: `Thinking: ${brief}`,
              metadata: withThread({
                kind: "chat_thinking",
                source: extractedThinking.thinking ? "agent" : "heuristic",
              }),
            } as never);
            await db.from("rgaios_audit_log").insert({
              organization_id: orgId,
              kind: "chat_thinking",
              actor_type: "agent",
              actor_id: agentId,
              detail: {
                brief,
                source: extractedThinking.thinking ? "agent" : "heuristic",
                message_preview: lastContent.slice(0, 100),
              },
            } as never);
          }
        } catch {
          // Best-effort - never block the reply on the thinking trace.
        }

        // 4a. Extract <task> blocks BEFORE the brand-voice filter. The
        // task description often quotes Rawgrowth's own banned-words
        // list verbatim (Atlas writes "Zero banned words: game-changer,
        // unlock, leverage..."), which trips the filter on the entire
        // reply even though the customer-visible text is clean. Pulling
        // tasks out first means filter only sees the surrounding prose.
        let preFilterText = replyBody;
        let createdTasks: Array<{
          routineId: string;
          runId: string | null;
          title: string;
          assigneeAgentId: string;
          assigneeName: string;
        }> = [];
        try {
          const ext = await extractAndCreateTasks({
            orgId,
            speakerAgentId: agentId,
            reply: replyBody,
          });
          preFilterText = ext.visibleReply || replyBody;
          createdTasks = ext.tasks;
        } catch (err) {
          console.warn(
            "[chat] task extraction failed:",
            (err as Error).message,
          );
        }

        // 4a-ter. JSON command extraction. Atlas (CEO) and dept heads
        // can emit <command type="tool_call|agent_invoke|routine_create">
        // blocks whose body is JSON. The handler executes each command
        // server-side (composio action / dispatch a routine to a sub-
        // agent / create a scheduled routine) and we post a single
        // system message summarising results back into the chat. This
        // is the response-side substitute for the MCP wire-protocol
        // that Anthropic's OAuth gate refuses to combine with on-call
        // tool_use today.
        // `detail` carries the structured payload the orchestration
        // cards render: composio result_preview, the delegated agent's
        // real output + status, etc. Keep it on the wire so the client
        // shows the actual content, not just "dispatched".
        let commandResults: Array<{
          ok: boolean;
          type: string;
          summary: string;
          detail?: Record<string, unknown>;
        }> = [];
        try {
          const ext = await extractAndExecuteCommands({
            orgId,
            speakerAgentId: agentId,
            reply: preFilterText,
            callerUserId: userId,
            // Live status: stream "Kasia is answering now" / "Running
            // gmail" the moment each command starts, before the slow
            // tool call or delegated run returns.
            onProgress: (ev) => {
              // HOTFIX H-ARCH-1: humanize happens centrally in emit().
              const niceLabel = ev.label;
              const verb =
                ev.type === "agent_invoke"
                  ? `${niceLabel} is answering now`
                  : ev.type === "tool_call"
                    ? `Running ${niceLabel}`
                    : ev.type === "routine_create"
                      ? `Creating routine "${niceLabel}"`
                      : `Working on ${niceLabel}`;
              emit({ type: "command_running", verb, label: ev.label });
            },
          });
          if (ext.results.length > 0) {
            preFilterText = ext.visibleReply || preFilterText;
            commandResults = ext.results;
          }
        } catch (err) {
          console.warn(
            "[chat] command extraction failed:",
            (err as Error).message,
          );
        }

        // 4a-2. Second pass: feed the tool/delegation results back to the
        // agent so the operator-visible reply actually USES the data -
        // "Here are the last 5 posts: ..." instead of "Pulling now."
        // (the pull already happened). One extra LLM call, only when a
        // command ran. The agent is told NOT to emit new <command>
        // blocks, and any it emits anyway are stripped, not executed.
        if (commandResults.length > 0) {
          try {
            const resultsBlock = commandResults
              .map((r, i) => {
                const d = r.detail ?? {};
                // agent_invoke: the dept head's real output. tool_call:
                // the human summary PLUS the raw payload preview, so the
                // agent can actually answer questions about it ("read
                // the body", "which email is the payment one") instead
                // of only seeing the one-line summary.
                let out: string;
                if (
                  typeof d.delegated_output === "string" &&
                  d.delegated_output
                ) {
                  out = d.delegated_output;
                } else if (
                  r.type === "tool_call" &&
                  typeof d.result_preview === "string" &&
                  d.result_preview
                ) {
                  out = `${r.summary}\n\nRaw payload (use this to answer detail questions):\n${d.result_preview}`;
                } else {
                  out = r.summary;
                }
                return `[${i + 1}] ${r.type} ${r.ok ? "(ok)" : "(failed)"}:\n${out}`;
              })
              .join("\n\n");

            // P0-6 I3: surface refine-verdicts hard so pass-2 reacts.
            // verifyDelegatedOutput buries verdict='refine' inside the
            // result detail; without this directive the orchestrator
            // model paraphrases the critic note in prose and never re-
            // dispatches. List which delegation got the refine + the
            // critic's reason, then tell the model to either re-dispatch
            // or explain why the deliverable is acceptable as-is.
            const refineNotes = commandResults
              .map((r, i) => {
                const detail = r.detail ?? {};
                const v = detail.verification as
                  | { verdict?: string; note?: string }
                  | undefined;
                if (!v || v.verdict !== "refine") return null;
                const assignee = detail.assignee_name ?? `result [${i + 1}]`;
                return `[${i + 1}] ${assignee}: ${v.note ?? "critic flagged refine"}`;
              })
              .filter((s): s is string => s !== null);
            const refineDirective =
              refineNotes.length > 0
                ? "\n\nREFINE-VERDICT - MANDATORY RE-DISPATCH OR JUSTIFY:\n" +
                  "The independent critic flagged one or more delegated deliverables as needing refinement. " +
                  "You MUST EITHER (a) emit ONE follow-on <command> block that re-dispatches to the same assignee with a SHARPER brief that addresses the critic note, " +
                  "OR (b) in your visible reply explain in one sentence why the deliverable is acceptable as-is despite the flag. " +
                  "Do NOT silently pass the flagged output to the operator.\n" +
                  "Refine notes:\n" +
                  refineNotes.join("\n") +
                  "\n"
                : "";
            // HOTFIX 7: snapshot the result count BEFORE pass-2 fires
            // so we can detect "pass-2 emitted fresh commands" without
            // re-counting the merged array later. Used by the empty-
            // visible-reply fallback below.
            const preTry2ResultCount = commandResults.length;
            const pass2 = await chatReply({
              organizationId: orgId,
              organizationName: ctx.activeOrgName,
              chatId: 0,
              userMessage: lastContent,
              publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
              agentId,
              historyOverride: [
                ...history,
                { role: "user", content: lastContent },
              ],
              extraPreamble:
                extraPreamble +
                "\n\n═══ TOOL RESULTS - YOU ALREADY RAN THESE ═══\n" +
                "You emitted command block(s) on the previous turn and the system executed them. The real results are below.\n\n" +
                "Open your reply with a <thinking> block that is your OBSERVATION step: in one or two sentences, say what the results actually show and what you make of them (\"3 emails back, all the same membership-confirmation template\" / \"Kasia delivered 3 usable hooks, the contrarian one is strongest\"). This is the Observation in Thought -> Action -> Observation - it must reference the real data, not be generic.\n\n" +
                // RANKED / FILTERED GROUNDING (Marti GAP #12 wrong-info root cause,
                // inv-logic-thinking D5). When operator asked for a ranked or filtered
                // list, OBSERVATION must declare the ranking field + window + source
                // and every visible item must cite its metric.
                "RANKED / FILTERED ANSWERS - GROUNDING RULE: when the operator asked for a ranked or filtered list (top N by X, latest N in window Y, most-engaged Z), your OBSERVATION <thinking> MUST include a one-line declaration: `ranked_by: <field>, window: <if any>, source: <tool/dataset>`. The visible answer MUST inline-cite the metric value per item that justifies its position (\"@advicewithjean - 2,125 comments\", \"@codiesanchez - 1,261 comments\"). NEVER claim 'top by X' while ordering by anything else - that is the wrong-info failure mode. If the tool result surface includes a `Top by comments: ...` header (apify or composio Instagram), rank YOUR visible reply by THAT header, not by the order of the body.\n\n" +

                "Then write your final answer to the operator USING this data - quote the actual emails / posts / numbers / the delegated agent's actual output. Do NOT say 'pulling now' or 'on it' for the work that is already done. You MAY emit ONE follow-on <command> block IF the results genuinely call for a next action you could not have known to take before seeing them - e.g. now that you have the top post, dispatch Kasia to draft hooks off it. If you do, the system runs it and shows the card; if you only say you are doing it, you MUST emit it (SAY-IT-MEANS-DO-IT). Do NOT re-run a command that already ran above.\n\n" +
                resultsBlock +
                refineDirective,
              noHandoff: true,
              // BUG-14 / R-MARTI-CANONICAL: pass-2 sees the tool result
              // block (e.g. 10 reels with captions + comment counts) and
              // must synthesise a numbered answer over it. The per-agent
              // default (4096) truncates at item 5-6 for top-10 lists +
              // captions, which surfaces as A's "no synthesis outside
              // card" / "5/50 items previewed" report. Floor pass-2 at
              // 8192 when commandResults were produced - keeps pass-1
              // budget conservative, only bumps the resynthesis turn.
              maxTokens: Math.max(agentMaxTokens ?? 0, 8192),
              callerUserId: userId,
            });
            if (pass2.ok && pass2.reply.trim()) {
              // Pass 2 CAN legitimately emit a command - a delegation or
              // tool call that only makes sense after seeing the pass-1
              // results ("now that I have the top post, dispatch Kasia").
              // The old code stripped + discarded those, so the agent
              // narrated a dispatch it never actually emitted (the e2e
              // test caught exactly this). Execute pass-2 commands ONCE
              // more - bounded, no pass 3 - and append their cards to
              // commandResults so they render + persist with the rest.
              let pass2Visible = pass2.reply;
              try {
                const ext2 = await extractAndExecuteCommands({
                  orgId,
                  speakerAgentId: agentId,
                  reply: pass2.reply,
                  callerUserId: userId,
                  onProgress: (ev) => {
                    // HOTFIX 8b prime: humanize spinner label on
                    // pass-2 onProgress path too. Same rationale as
                    // the pass-1 site above.
                    const niceLabel = humanizeJargon(ev.label);
                    const verb =
                      ev.type === "agent_invoke"
                        ? `${niceLabel} is answering now`
                        : ev.type === "tool_call"
                          ? `Running ${niceLabel}`
                          : ev.type === "routine_create"
                            ? `Creating routine "${niceLabel}"`
                            : `Working on ${niceLabel}`;
                    emit({ type: "command_running", verb, label: ev.label });
                  },
                });
                if (ext2.results.length > 0) {
                  pass2Visible = ext2.visibleReply || pass2.reply;
                  commandResults = [...commandResults, ...ext2.results];
                }
              } catch (err) {
                console.warn(
                  "[chat] pass-2 command extraction failed:",
                  (err as Error).message,
                );
              }
              const pass2Thinking = extractThinkingRaw(pass2Visible);
              // Pass 2's <thinking> is the Observation step - emit it as
              // a second reasoning trace so the operator sees the full
              // ReAct chain: plan (pass 1) -> tool cards -> observation
              // (pass 2) -> answer. Best-effort, never blocks the reply.
              if (pass2Thinking.thinking) {
                emit({ type: "thinking", brief: pass2Thinking.thinking });
                try {
                  await db.from("rgaios_agent_chat_messages").insert({
                    organization_id: orgId,
                    agent_id: agentId,
                    user_id: null,
                    role: "system",
                    content: `Thinking: ${pass2Thinking.thinking}`,
                    metadata: withThread({ kind: "chat_thinking", source: "agent", step: "observation" }),
                  } as never);
                } catch {}
              }
              if (pass2Thinking.visibleReply) {
                preFilterText = pass2Thinking.visibleReply;
              }
              // DELEGATION PASS-3 WEAVE (2026-05-17, Pedro CEO bug): pass-2
              // wrote dispatch framing BEFORE agent_invoke executed, so
              // Kasia's ranked list (detail.delegated_output, see agent-
              // commands.ts:1242) never lands in Scan's prose. One bounded
              // pass-3, no new <command>, weave the deliverable.
              try {
                const newDel = commandResults.slice(preTry2ResultCount).filter(
                  (r) =>
                    r.type === "agent_invoke" && r.ok &&
                    typeof r.detail?.delegated_output === "string" &&
                    (r.detail.delegated_output as string).trim().length > 0,
                );
                const vis = (preFilterText ?? "").trim();
                const woven = newDel.some((r) => {
                  const p = (r.detail!.delegated_output as string).trim().slice(0, 40);
                  return p.length >= 40 && vis.includes(p);
                });
                if (newDel.length > 0 && !woven) {
                  const weaveBlock = newDel.map((r, i) => {
                    const d = r.detail ?? {};
                    const name = typeof d.assignee_name === "string" ? d.assignee_name : `assignee[${i + 1}]`;
                    return `[${i + 1}] ${name} delivered:\n${(d.delegated_output as string).slice(0, 4000)}`;
                  }).join("\n\n");
                  const pass3 = await chatReply({
                    organizationId: orgId,
                    organizationName: ctx.activeOrgName,
                    chatId: 0,
                    userMessage: lastContent,
                    publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
                    agentId,
                    historyOverride: [...history, { role: "user", content: lastContent }],
                    extraPreamble: extraPreamble +
                      "\n\n═══ DELEGATION JUST RETURNED ═══\nThe assignee's actual deliverable is below. Weave the concrete items (with @handle + metric per line where applicable) into your reply. Do NOT emit new <command> blocks. Do NOT say 'dispatching' or 'on it' - the work is done. Quote the real data.\n\n" +
                      weaveBlock,
                    noHandoff: true,
                    maxTokens: agentMaxTokens,
                    callerUserId: userId,
                  });
                  if (pass3.ok && pass3.reply.trim()) {
                    const stripped = extractThinkingRaw(pass3.reply).visibleReply
                      .replace(/<command[\s\S]*?<\/command>/gi, "").trim();
                    if (stripped.length > 0) preFilterText = stripped;
                  }
                }
              } catch (err) {
                console.warn("[chat] pass-3 delegation weave failed:", (err as Error).message);
              }
              // HOTFIX 7 (2026-05-17): chat-finalize hang after a
              // pass-2 that emitted a successful command but no
              // surrounding prose. R5/R9 v2 walk reproduced it:
              // - pass 1 fired agents_update (failed, coercion error)
              // - pass 2 retried agents_update (ok)
              // - pass 2 reply body was ONLY the <command> block - no
              //   visible text - so after extract+strip the visibleReply
              //   was empty, no preFilterText override, no "Done"
              //   message ever rendered. The model treated the retry-
              //   succeeded as terminal and the operator saw "thinking..."
              //   then silence for 3min+.
              // Fix: if pass-2 ran fresh commands AND the visible reply
              // is empty/trivial (<20 chars after trim, since the model
              // sometimes prepends "Retrying..." then nothing), synthesize
              // a one-liner from those NEW pass-2 results. Mirror the
              // operator's input language hint via the same preamble rule
              // (DO NOT explicitly translate - the SAY-IT format covers
              // English; the agent's own re-render would localize, but we
              // can't run a 3rd pass safely so flat English is acceptable
              // for the fallback path).
              const pass2EmittedCommands = commandResults.length > preTry2ResultCount;
              const visibleAfterStrip = (pass2Thinking.visibleReply ?? "").trim();
              // HOTFIX 11 (2026-05-17): R5/R9 v4 walk surfaced the
              // visibleAfterStrip <20 char threshold missing the
              // "Retrying with my UUID this time." case (38 chars, but
              // still an intermediate-state phrase, NOT the operator's
              // final answer). Tighten the synth trigger to ALSO fire
              // on common retry-intermediate openers regardless of
              // length. AND if pass-2 ran but ALL its commands failed,
              // emit a clear "couldn't complete" message instead of
              // letting the retry-mid-sentence sit there as final.
              // HOTFIX 11b (2026-05-17): extend regex per R-MARTI-2
              // walk. Marta hung on "File name didn't resolve - let me
              // pull..." which starts with "File" - not matched by the
              // original verb-list. Add file/name/lookup recovery
              // phrases + generic "I'll <verb>" / "I need to <verb>"
              // so the synth fallback catches every common recovery
              // intermediate.
              // HOTFIX 11c (2026-05-17, R-MARTI-2 v2 follow-up): the
              // `^` anchor missed common article prefixes. Marta's
              // actual visible was "The file name didn't match - let me
              // pull..." starting with "The " - the regex never fired,
              // synth fallback only triggered via the <20 char branch.
              // Strip a leading the/a/an article before matching so the
              // intermediate detector catches naturally-phrased
              // sentences too.
              // HOTFIX 11d (2026-05-17, R-ORCH-3 follow-up): also
              // strip a leading proper-noun + optional possessive
              // ("Marta " / "Marta's ") so e.g. "Marta hit a rate-limit
              // on the first try, retrying the dispatch now..." flips
              // to "hit a rate-limit..." for the regex test. And add
              // rate-limit / run-limit / dispatch-failed phrasings as
              // new intermediate-state alternations - Scan's CEO-style
              // retry sentences phrase the symptom not the verb.
              const visibleForIntermediate = visibleAfterStrip
                .replace(/^(the|a|an)\s+/i, "")
                .replace(/^([A-Z][a-z]+(?:'s)?)\s+/, "")
                .trim();
              const looksLikeIntermediate =
                /^(retrying|trying|attempting|let me retry|one moment|hold on|working on|let me try|let me pull|let me check|let me look|let me search|let me query|couldn't find|file (name )?didn't|missing|need to (look|find|check|pull|search|query)|searching|querying|pulling|checking|looking up|i'?ll (try|retry|check|pull|look|search|query)|hit (a|the|our) (rate|run|quota)[-\s]?limit|dispatch failed|delegation failed|run-limit|rate-limit)/i
                  .test(visibleForIntermediate);
              if (
                pass2EmittedCommands &&
                (visibleAfterStrip.length < 20 || looksLikeIntermediate)
              ) {
                const pass2Results = commandResults.slice(preTry2ResultCount);
                const allFailed =
                  pass2Results.length > 0 &&
                  pass2Results.every((r) => !r.ok);
                if (allFailed) {
                  // No success to summarize - explicit failure copy.
                  // Don't repeat the tool error verbatim (it's already
                  // in the FAILED card); say plainly that nothing went
                  // through + offer rephrase, so the operator isn't
                  // left staring at "Retrying with my..." as final.
                  const tools = Array.from(
                    new Set(
                      pass2Results.map((r) =>
                        typeof r.detail?.tool === "string"
                          ? humanizeJargon(r.detail.tool)
                          : "tool",
                      ),
                    ),
                  ).join(", ");
                  preFilterText =
                    `Couldn't complete that one - the ${tools} call failed on every retry. ` +
                    "Want to try rephrasing it, or should I take a different approach?";
                } else {
                  // HOTFIX 8 lift: operator-facing one-liner per result.
                  // Cap each preview at 240 chars so a long system_
                  // prompt doesn't blow up the message.
                  const lines = pass2Results.map((r) => {
                    const detail = r.detail ?? {};
                    const tool = typeof detail.tool === "string" ? detail.tool : "tool";
                    const preview =
                      typeof detail.result_preview === "string"
                        ? (detail.result_preview as string)
                        : r.summary;
                    if (r.ok && tool === "agents_update") {
                      const firstLine = preview.split("\n")[0].replace(/\*\*/g, "");
                      return firstLine.slice(0, 240);
                    }
                    // DELEGATION PASS-3 SYNTH (2026-05-17): agent_invoke
                    // success - use delegated_output head, not r.summary
                    // (which is just dispatch framing).
                    const delegatedOut =
                      typeof detail.delegated_output === "string" ? (detail.delegated_output as string) : null;
                    if (r.ok && r.type === "agent_invoke" && delegatedOut) {
                      const assignee = typeof detail.assignee_name === "string" ? (detail.assignee_name as string) : "assignee";
                      return `${assignee}: ${delegatedOut.slice(0, 600)}`;
                    }
                    if (r.ok) {
                      return `Done - ${tool}: ${preview.split("\n")[0]}`.slice(0, 240);
                    }
                    return `Heads-up - ${tool} hit a snag: ${preview.split("\n")[0]}`.slice(0, 240);
                  });
                  preFilterText = `Done.\n\n${lines.join("\n")}`;
                }
              }
              // HOTFIX 12b (2026-05-17, B 17:08 SPEC): force-prepend
              // the agents_update echo line when the model wrote its
              // OWN reply (so the synth-fallback above didn't fire)
              // and that reply doesn't already quote the new field
              // value verbatim. R5/R9 v6 walk: model wrote
              // "Done - 'Be punchy and casual.' appended..." instead
              // of "Done. New description: <full body>". Operator
              // can't verify a paraphrase. Pull the canonical
              // "New <field>: <value>" line from the tool result
              // preview and prepend it if missing.
              if (pass2EmittedCommands && preFilterText.trim().length > 0) {
                const pass2Results = commandResults.slice(preTry2ResultCount);
                const okUpdate = pass2Results.find(
                  (r) =>
                    r.ok &&
                    typeof r.detail?.tool === "string" &&
                    (r.detail.tool as string) === "agents_update",
                );
                if (okUpdate) {
                  const detail = okUpdate.detail ?? {};
                  const preview =
                    typeof detail.result_preview === "string"
                      ? (detail.result_preview as string)
                      : okUpdate.summary;
                  const echoLine =
                    preview
                      .split("\n")
                      .map((l) => l.replace(/\*\*/g, "").trim())
                      .find((l) => /^New\s+[A-Za-z_]+:/.test(l)) ?? null;
                  if (echoLine && !preFilterText.includes(echoLine)) {
                    preFilterText = `${echoLine}\n\n${preFilterText.trim()}`;
                  }
                }
              }
            }
          } catch (err) {
            console.warn(
              "[chat] second-pass reply failed:",
              (err as Error).message,
            );
            // Fallback: if pass2 OBSERVATION threw (commonly "Controller is
            // already closed" when the stream timed out before pass2 finished),
            // synthesize a minimal reply from the tool results so the
            // operator still gets a persisted assistant message instead of
            // a silent dropped turn. Without this, the chat reload shows
            // user + reasoning + tool cards but NO assistant reply, and the
            // tool output that just rendered live disappears.
            if (commandResults.length > 0 && !preFilterText.trim()) {
              const summary = commandResults
                .filter((r) => r.ok)
                .map((r) => {
                  const detailText =
                    (r.detail && typeof r.detail.text === "string"
                      ? (r.detail.text as string)
                      : null) ||
                    (r.detail && typeof r.detail.outputText === "string"
                      ? (r.detail.outputText as string)
                      : null);
                  return detailText || r.summary;
                })
                .join("\n\n")
                .slice(0, 4000);
              if (summary) {
                preFilterText =
                  "Tool results below (synthesis step was interrupted by stream timeout, raw output preserved):\n\n" +
                  summary;
              }
            }
          }
        }

        // 4a-bis. Data-ask extraction. Atlas (or any agent following the
        // DATA-ASK PROTOCOL in preamble.ts) can emit <need scope="..."> blocks
        // when it genuinely lacks data. We strip those blocks from the
        // visible reply, post a follow-up assistant message asking the
        // operator to supply the data, and surface the scope so the UI
        // can later upgrade these into Data Entry stubs.
        try {
          const needRegex = /<need(?:\s+scope=["']([^"']+)["'])?\s*>([\s\S]*?)<\/need>/gi;
          const needs: Array<{ scope: string; text: string }> = [];
          let m: RegExpExecArray | null;
          while ((m = needRegex.exec(preFilterText)) !== null) {
            const scope = (m[1] ?? "other").trim();
            const text = m[2].trim();
            if (text) needs.push({ scope, text });
          }
          if (needs.length > 0) {
            preFilterText = preFilterText.replace(needRegex, "").trim();
            await Promise.all(
              needs.map((n) =>
                db.from("rgaios_agent_chat_messages").insert({
                  organization_id: orgId,
                  agent_id: agentId,
                  user_id: null,
                  role: "assistant",
                  content: `I need: ${n.text}. Paste it in this chat or use Data Entry.`,
                  metadata: withThread({ kind: "data_ask", scope: n.scope }) as never,
                } as never),
              ),
            );
          }
        } catch (err) {
          console.warn(
            "[chat] data-ask extraction failed:",
            (err as Error).message,
          );
        }

        // 4a-quater. Shared-memory extraction. Agents emit
        // <shared_memory importance="N" scope="...">FACT</shared_memory>
        // when they learn something peers need. extractSharedMemoryBlocks
        // exists but was never wired into the dashboard chat route, so
        // the raw XML leaked into the visible reply AND the fact was
        // never persisted. Now: strip the blocks, persist each fact.
        try {
          const sm = await persistSharedMemoryFromReply({
            orgId,
            sourceAgentId: agentId,
            sourceChatId: null,
            reply: preFilterText,
          });
          preFilterText = sm.visibleReply || preFilterText;
        } catch (err) {
          console.warn(
            "[chat] shared-memory extraction failed:",
            (err as Error).message,
          );
        }

        // 4a-quinquies. Final bare-JSON safety net. When extractAndExecute-
        // Commands runs the bare-JSON dispatch path but the command fails
        // (Kasia rate-limited, agent_invoke validation rejected, etc), the
        // rawSpan can survive in preFilterText and ride through brand
        // filter into the visible delta. stripBareJsonCommands uses the
        // SAME classifyBareJsonObject signature so it only strips spans
        // that *would* have been valid commands. Cosmetic-only: the
        // command intent is intentionally lost because dispatch already
        // ran (or failed) upstream. Protects against the post-refusal
        // "{ agent: Kasia, task: ... }" dump observed in v161/v163/v165.
        preFilterText = stripBareJsonCommands(preFilterText);

        // 4b. Brand-voice filter on the visible text only. Audit row is
        // written inside applyBrandFilter for both regenerated and
        // hard-fail outcomes - no extra writes needed here.
        const filtered = await applyBrandFilter(preFilterText, {
          organizationId: orgId,
          agentId,
          surface: SURFACE,
        });

        const preRedactVisible = filtered.ok ? filtered.text : HARD_FAIL_MESSAGE;

        // Outbound secret scrub. Models echo back pasted creds in
        // their own "rotate that key" warnings (Scan repeated
        // ak_gHrg9Sor... verbatim). Redact-on-finalize is the
        // security gate - intermediate buffer in client is
        // best-effort only.
        const outboundScrub = redactSecrets(preRedactVisible);
        const visibleText = outboundScrub.redacted;
        if (outboundScrub.hits.length > 0) {
          console.warn(
            "[chat] outbound secret_redacted:",
            JSON.stringify({
              org_id: orgId,
              agent_id: agentId,
              kinds: outboundScrub.hits.map((h) => h.kind),
            }),
          );
          emit({
            type: "secret_redacted",
            hits: outboundScrub.hits.map((h) => h.kind),
          });
        }

        const persistMetadata = filtered.ok
          ? {
              regenerated: filtered.regenerated,
              tasks_created: createdTasks.map((t) => ({
                routine_id: t.routineId,
                run_id: t.runId,
                assignee_agent_id: t.assigneeAgentId,
                title: t.title,
              })),
            }
          : {
              kind: "brand_voice_hard_fail",
              hits: filtered.hits,
              final_attempt_excerpt: filtered.finalAttempt.slice(0, 500),
            };

        // HOTFIX H-ARCH-1: humanize happens centrally in emit().
        // TASK #141: Belt-and-suspenders strip of any raw `{"tool":...,
        // "args":{...}}` JSON dict that leaked past the upstream
        // <command>-block stripper (extractAndExecuteCommands sometimes
        // misses bare JSON the agent emits outside the <command> wrapper).
        // Pedro banned operator-visible raw tool payloads ("TIPO CHAMAR
        // APIFY_TOOL_CALL KRL"); strip the literal pattern here so it
        // never reaches the chat card body. Conservative regex: only
        // matches a top-level object that has BOTH "tool" and "args" keys
        // so plain operator JSON in conversation stays intact.
        const visibleTextScrubbed = visibleText.replace(
          /\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\s*\}/g,
          "",
        ).replace(/\n{3,}/g, "\n\n").trim();
        emit({ type: "text", delta: visibleTextScrubbed });
        if (createdTasks.length > 0) {
          emit({ type: "tasks_created", tasks: createdTasks });
        }
        if (commandResults.length > 0) {
          // Surface each command result as a system row so the operator
          // can see WHAT just got executed in their behalf (Composio
          // action ran, dept head was invoked, routine created). Best-
          // effort - the visible chat text already streamed.
          emit({ type: "commands_executed", results: commandResults });
          const summary = commandResults
            .map(
              (r, i) => `${i + 1}. [${r.ok ? "ok" : "fail"}] ${r.type} - ${r.summary}`,
            )
            .join("\n");
          try {
            await db.from("rgaios_agent_chat_messages").insert({
              organization_id: orgId,
              agent_id: agentId,
              user_id: null,
              role: "system",
              content: `Commands executed:\n${summary}`,
              metadata: withThread({
                kind: "chat_commands_executed",
                results: commandResults,
              }) as never,
            } as never);
          } catch (err) {
            console.warn(
              "[chat] command system message insert failed:",
              (err as Error).message,
            );
          }
        }

        // 5. Persist the assistant reply (or operator-warning sentinel).
        // Log the cause of any failure so we don't silently lose a reply
        // the operator just saw stream into the page. The client already
        // has the visible text so we don't fail the request - just
        // surface the issue in server logs for follow-up.
        const assistantInsert = await db
          .from("rgaios_agent_chat_messages")
          .insert({
            organization_id: orgId,
            agent_id: agentId,
            user_id: null,
            role: "assistant",
            content: visibleText,
            metadata: withThread(persistMetadata),
          } as never);
        if (assistantInsert.error) {
          console.error(
            "[chat] assistant insert failed:",
            assistantInsert.error.message,
          );
        }

        // 5b. Distil ONE concrete fact from this turn and persist it as
        // a chat_memory row that the next-turn preamble can inject as
        // "things you remember". The previous template-slice heuristic
        // stripped numbers from tool-result replies, so the preamble
        // re-injected number-stripped lines as ground truth and the
        // model filled the gaps from nowhere - the dominant source of
        // cross-turn metric hallucination.
        //
        // extractChatMemoryFact returns null on filler turns, on Haiku
        // errors, and when no API key is set. Null = skip the write.
        // The preamble fetcher silently tolerates an empty set, so a
        // skipped write costs nothing downstream and avoids storing a
        // hollow fact that the next turn would treat as authoritative.
        const skipMemory =
          !filtered.ok ||
          lastContent.trim().length < 30 ||
          visibleText.trim().length < 30;
        if (!skipMemory) {
          try {
            const fact = await extractChatMemoryFact(lastContent, visibleText);
            if (fact) {
              await db.from("rgaios_audit_log").insert({
                organization_id: orgId,
                kind: "chat_memory",
                actor_type: "agent",
                actor_id: agentId,
                detail: {
                  agent_id: agentId,
                  fact,
                  user_id: userId,
                },
              });
            }
          } catch (err) {
            console.warn("[chat] memory extract failed:", (err as Error).message);
          }
        }

        emit({ type: "done" });
        controller.close();
      } catch (err) {
        emit({
          type: "error",
          message: (err as Error).message ?? "stream failed",
        });
        emit({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

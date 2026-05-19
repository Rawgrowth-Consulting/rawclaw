/**
 * Reasoning-trace extraction.
 *
 * Agents are instructed by the REASONING PROTOCOL block in preamble.ts to
 * open every reply with a <thinking>...</thinking> block - the ReAct
 * "Thought" step: the same model that writes the answer first states its
 * real plan for the turn (what the operator wants, delegate-or-answer, why).
 *
 * This module pulls that block back out so the surfaces can:
 *   - strip it from the operator-visible reply (it must never render raw),
 *   - surface it as a separate "thinking" trace line (dashboard SSE event /
 *     Telegram italic prefix / rgaios_audit_log row for /trace).
 *
 * It is the response-side equivalent of the old pre-reply Haiku guess in
 * the chat route, except it is the agent's ACTUAL reasoning rather than a
 * separate model guessing at intent.
 */

import { supabaseAdmin } from "@/lib/supabase/server";
import { stripOrchestrationMarkup } from "@/lib/agent/markup";

const THINKING_RE = /<thinking>\s*([\s\S]*?)\s*<\/thinking>/i;
const THINKING_OPEN_RE = /<thinking>/i;
const THINKING_CLOSE_RE = /<\/thinking>/i;
const THINKING_FULL_BLOCK_RE = /<thinking>[\s\S]*?<\/thinking>/gi;
const THINKING_UNPAIRED_TAG_RE = /<\/?thinking>/gi;

// Pedro 2026-05-19: the model sometimes emits naked reasoning at the
// TOP of the reply (no <thinking> tags) - lines starting with "💭 "
// or meta-narration "User just said X..." / "Operator just said Y...".
// These never belong in the operator-visible Telegram reply. Strip
// every such line + any blank lines immediately after, until the
// first line that is real prose.
const NAKED_REASONING_LINE_RE =
  /^[\s>*_-]*(?:💭|🧠|🤔)[^\n]*\n?/;
const META_NARRATION_LINE_RE =
  /^\s*(?:User|Operator|The user|The operator)\s+(?:just\s+(?:said|asked|wrote|typed)|is\s+(?:asking|saying|telling))[^\n]*\n?/i;

/**
 * Drop leading reasoning leak lines that the model emitted outside of
 * <thinking> tags. Repeats until no more leading reasoning lines exist
 * so multi-line preambles get stripped together.
 */
function stripNakedReasoningPreamble(text: string): string {
  let out = text;
  // Up to 5 passes - that is more than enough for the few leak shapes
  // the model has been observed to produce and prevents any
  // pathological infinite loop on an unexpected input.
  for (let i = 0; i < 5; i++) {
    const before = out;
    out = out.replace(NAKED_REASONING_LINE_RE, "");
    out = out.replace(META_NARRATION_LINE_RE, "");
    out = out.replace(/^\s*\n+/, "");
    if (out === before) break;
  }
  return out;
}
// P4 batch 1 (per B 02:53 → C, from C 02:40 simplify):
// regex `/\s*\n\s*/g` appeared 4x inline; hoist to one module const.
const NEWLINE_COLLAPSE = /\s*\n\s*/g;

const MAX_THINKING_CHARS = 600;

export type ExtractedThinking = {
  /** The reasoning text, trimmed + collapsed, or null if no block found. */
  thinking: string | null;
  /** The reply with the <thinking> block removed and edges trimmed. */
  visibleReply: string;
};

/**
 * Drop stray bare <thinking>/</thinking> tags. Used after we have
 * already stripped the matched paired block - this catches any
 * lone open/close that survived (model truncation, partial XML).
 */
function stripUnpairedThinkingTags(text: string): string {
  return text.replace(THINKING_UNPAIRED_TAG_RE, "");
}

/**
 * Trim, single-line collapse, length-cap. Used everywhere the
 * extracted reasoning trace is about to be surfaced; centralising
 * the shape keeps the chat / Telegram / audit row consistent.
 */
function normaliseThinking(raw: string): string | null {
  const collapsed = raw.replace(NEWLINE_COLLAPSE, " ").trim();
  return collapsed ? collapsed.slice(0, MAX_THINKING_CHARS) : null;
}

/**
 * Pull the first <thinking> block out of a model reply.
 *
 * - Only the FIRST block is treated as the reasoning trace; any further
 *   blocks are still stripped from the visible reply so stray XML never
 *   leaks, but they are not surfaced.
 * - Newlines inside the block collapse to single spaces - the trace
 *   renders as one line in chat / Telegram / audit.
 * - Caps the surfaced text at MAX_THINKING_CHARS so a runaway block
 *   can't blow up an audit row or a Telegram message.
 */
// HOTFIX 8 (2026-05-17, FLEX MODE OPERATOR UX): swap developer jargon
// in the operator-visible reasoning trace for plain operator language.
// R5/R9 v2 walk leaked "coercion error" / "UUID" / "lookup ambiguity"
// directly into Kasia's reasoning panel - pure implementation noise
// that the operator never needs to see. The thinking string surfaces
// in two places (chat Reasoning chip + Telegram "💭 ..." prefix) so
// the transform lives at extractThinking's boundary, not at the emit
// site, so any new caller inherits the humanization automatically.
//
// IMPORTANT: this is a display-only transform. The original reasoning
// is still persisted to rgaios_audit_log (kind chat_thinking) with the
// raw text, so /trace + the developer view keep the technical content
// for debugging. Only the operator-visible chip is rewritten.
//
// HOTFIX 15 (2026-05-17, R-BELL notification walk): the map +
// humanizeJargon now live in src/lib/agent/jargon.ts (client-safe)
// so the notification bell + other "use client" surfaces can reuse
// it without dragging in supabaseAdmin (server-only).
import { humanizeJargon } from "./jargon";

export { humanizeJargon };

// GAP-4a (2026-05-18): the Reasoning surface renders the agent's
// `<thinking>` trace verbatim post-extraction, after humanizeJargon
// scrubs tool-name jargon. applyBrandFilter (chat/route.ts:1576)
// catches em-dash on the visible reply but NEVER touches the thinking
// trace, so any em-dash the model composes mid-reasoning slips through
// to the operator-visible Reasoning chip. Reproducers across 7+ walks
// today: R-KASIA-CADENCE 04:09 + R-KASIA-HOOK 04:41 + R-KASIA-AUDIT
// 05:24 (Kasia 75% em-dash rate) + R-EM-DLQ 04:05 + R-EM-INCIDENT 05:18
// (EM 50% rate). Pattern is composition-time variance, not per-agent
// system_prompt - per-agent intervention would miss 33-50% of slips.
// Mirror apply-filter.ts:51's lang-agnostic em-dash / en-dash / minus
// substitution: " - " with surrounding spaces so words don't collide.
export function scrubThinkingDashes(text: string): string {
  // GAP-cosmetic-3 (2026-05-18): consume surrounding whitespace so a
  // spaced em-dash ("judgment — I") doesn't produce double-spaces
  // ("judgment  -  I") after substitution. apply-filter.ts:51 has the
  // same shape - keep both in sync.
  return text.replace(/\s*[—–−]\s*/g, " - ");
}

/**
 * HOTFIX 30 (2026-05-17): split the thinking-strip and the jargon-
 * humanize so callers can persist the RAW (stripped but un-humanized)
 * reply text. Persisting the humanized form back to
 * rgaios_agent_chat_messages bled the humanized tool names into the
 * next-turn agent context window, the agent then emitted tool_call
 * payloads with the humanized phrase as `tool` (e.g. "scrape reels
 * from the creator list") and the execToolCall whitelist refused
 * because the canonical enum is "apify_top_reels_from_file". The
 * R-MARTI-CANONICAL v3..v5 walks all looped on this.
 *
 * extractThinkingRaw is the persistence-side variant: same XML strip,
 * no humanize. extractThinking (below) still wraps + humanizes for the
 * render-side callers that need an operator-clean string.
 */
export function extractThinkingRaw(reply: string): ExtractedThinking {
  if (!reply) return { thinking: null, visibleReply: reply ?? "" };
  const m = reply.match(THINKING_RE);
  if (!m) {
    const openOnly = reply.match(THINKING_OPEN_RE);
    if (openOnly && !THINKING_CLOSE_RE.test(reply)) {
      const idx = openOnly.index ?? 0;
      const cleaned = stripOrchestrationMarkup(
        reply.slice(idx + openOnly[0].length),
      );
      return {
        thinking: normaliseThinking(cleaned),
        visibleReply: reply.slice(0, idx).trim(),
      };
    }
    return {
      thinking: null,
      visibleReply: stripUnpairedThinkingTags(reply).trim(),
    };
  }
  const cleaned = stripOrchestrationMarkup(m[1] ?? "");
  const visibleReply = stripUnpairedThinkingTags(
    reply.replace(THINKING_FULL_BLOCK_RE, ""),
  ).trim();
  return { thinking: normaliseThinking(cleaned), visibleReply };
}

export function extractThinking(reply: string): ExtractedThinking {
  if (!reply) return { thinking: null, visibleReply: reply ?? "" };

  const m = reply.match(THINKING_RE);
  if (!m) {
    // Truncation case: the model is told to OPEN every reply with a
    // <thinking> block. If max_tokens cut the reply before the closing
    // </thinking>, THINKING_RE (which needs the close tag) does not
    // match - and the raw `<thinking>` open tag + reasoning would leak
    // into the operator-visible reply. Detect a lone open tag with no
    // close: everything after it is the (truncated) thinking, whatever
    // preceded it is the visible reply.
    const openOnly = reply.match(THINKING_OPEN_RE);
    if (openOnly && !THINKING_CLOSE_RE.test(reply)) {
      const idx = openOnly.index ?? 0;
      const cleaned = stripOrchestrationMarkup(
        reply.slice(idx + openOnly[0].length),
      );
      const trace = normaliseThinking(cleaned);
      return {
        thinking: trace ? scrubThinkingDashes(humanizeJargon(trace)) : null,
        visibleReply: humanizeJargon(reply.slice(0, idx).trim()),
      };
    }
    // No thinking markup at all - but still strip any stray lone tag
    // AND any naked reasoning preamble the model leaked at the top of
    // the reply (BUG-N 2026-05-19 - "💭 User just said hey" leaked into
    // Telegram with no <thinking> tag wrap).
    return {
      thinking: null,
      visibleReply: humanizeJargon(
        stripNakedReasoningPreamble(
          stripUnpairedThinkingTags(reply),
        ).trim(),
      ),
    };
  }

  // Strip any bare-JSON command shapes the model dumped into its
  // <thinking> trace. The reasoning surface renders this raw, and
  // Marti's live test on 6a60aa7 caught the leak: Kasia's thinking
  // included a "I'll call {tool: apify_run_actor, args: ...}" block
  // and the JSON rendered inline in the Reasoning card. The strip is
  // safe - thinking is narrative, not a command surface.
  const cleaned = stripOrchestrationMarkup(m[1] ?? "");
  const trace = normaliseThinking(cleaned);
  const thinking = trace ? scrubThinkingDashes(humanizeJargon(trace)) : null;

  // Strip ALL <thinking> blocks (the matched one + any extras) PLUS any
  // stray unpaired <thinking>/</thinking> tag so no raw XML survives
  // into the visible reply. Also strip any leading naked-reasoning
  // preamble (💭 / "User just said X") that the model leaked outside
  // the tagged block. Then humanize tool-name jargon so the operator
  // never sees raw internal identifiers in the reply body.
  const visibleReply = humanizeJargon(
    stripNakedReasoningPreamble(
      stripUnpairedThinkingTags(
        reply.replace(THINKING_FULL_BLOCK_RE, ""),
      ),
    ).trim(),
  );

  return { thinking, visibleReply };
}

/**
 * Telegram-surface variant. Pulls the <thinking> block, persists it to
 * rgaios_audit_log (kind chat_thinking) so the /trace timeline still
 * shows the Telegram-side reasoning the same way the dashboard chat
 * does, and returns the operator-visible text WITHOUT the reasoning
 * prefix.
 *
 * Pedro 2026-05-19 mandate: the operator should never see the agent's
 * private "💭 User just said X..." narration in Telegram - it reads as
 * a bug, not as a feature. /trace + the dashboard Reasoning chip stay
 * the homes for the trace. Telegram surface stays clean prose.
 *
 * Best-effort: a failed audit insert never blocks the reply, and a
 * reply with no <thinking> block is returned untouched.
 */
export async function surfaceThinkingTelegram(opts: {
  reply: string;
  organizationId: string;
  agentId: string | null;
  messagePreview?: string;
}): Promise<string> {
  const { thinking, visibleReply } = extractThinking(opts.reply);
  if (!thinking) return visibleReply;

  try {
    await supabaseAdmin()
      .from("rgaios_audit_log")
      .insert({
        organization_id: opts.organizationId,
        kind: "chat_thinking",
        actor_type: "agent",
        actor_id: opts.agentId,
        detail: {
          brief: thinking,
          source: "agent",
          surface: "telegram",
          message_preview: (opts.messagePreview ?? "").slice(0, 100),
        },
      } as never);
  } catch {
    // Best-effort - never block the Telegram reply on the trace row.
  }

  return visibleReply;
}

/**
 * Self-healing + self-learning wrapper around the Hermes chat bridge.
 *
 * Two compounding behaviors on top of `chatReplyViaHermes`:
 *
 *   1. SELF-LEARNING (`withMemoryContext`): before each turn, search
 *      the memory chain (Honcho + mem0 + Letta + Hermes local) for
 *      snippets relevant to the user's query and prepend them as
 *      "what we already know about this user" context. After the turn,
 *      write the (user message, assistant reply, tool calls, outcome)
 *      tuple to every enabled tier so the next similar query benefits.
 *
 *   2. SELF-HEALING (`withErrorRepairLoop`): if a turn fails or the
 *      assistant reply contains an error signature, run a bounded
 *      autoresearch loop where the goal is "produce a reply that does
 *      NOT contain the error signature", proposing fixes (rephrased
 *      prompts, added context from memory, tool retries with different
 *      args) until the score stops improving or maxCycles is hit.
 *      Each repaired turn writes the diagnostic + fix to memory so the
 *      same failure mode is recognized + sidestepped next time.
 *
 * Compose them: `chatReplySelfHealingLearning(input)` runs both. The
 * Hermes side already has the memory tools (mcp-memory) so the agent
 * can also self-heal mid-turn via tool calls; this wrapper adds the
 * outer loop bookkeeping that survives across turns.
 */

import { autoresearch } from "@/lib/hermes/autoresearch";
import { chatReplyViaHermes } from "@/lib/hermes/bridge";
import { writeMemory, readMemory, type MemorySnippet } from "@/lib/memory";
import type { ChatReplyInput } from "@/lib/agent/chat";
import {
  ERROR_SIGNATURES,
  errorScore,
  looksLikeError,
} from "@/lib/hermes/self-healing-score";

export { ERROR_SIGNATURES, errorScore, looksLikeError };

type AgentChatResult =
  | { ok: true; reply: string; healed?: boolean; learned?: number; cycles?: number }
  | { ok: false; error: string };

export type ChatInput = ChatReplyInput;

/* -------------------------------------------------------------------- */
/* Self-learning: read memory before, write memory after                 */
/* -------------------------------------------------------------------- */

export async function withMemoryContext(
  input: ChatInput,
): Promise<AgentChatResult> {
  const session = `org:${input.organizationId}:chat:${input.chatId}`;

  // 1. Read every tier in parallel for context
  let snippets: MemorySnippet[] = [];
  try {
    snippets = await readMemory({
      organizationId: input.organizationId,
      agentId: input.agentId ?? "default",
      userId: input.callerUserId ?? null,
      session,
      query: input.userMessage,
      limit: 5,
    });
  } catch (err) {
    console.warn("[self-learning] readMemory failed:", err);
  }

  const memoryBlock = snippets.length
    ? "## Relevant memory from prior turns\n" +
      snippets
        .map(
          (s, i) =>
            `${i + 1}. [${s.source}${s.score != null ? ` score=${s.score.toFixed(2)}` : ""}] ${s.content}`,
        )
        .join("\n") +
      "\n\nUse the above context where directly relevant; ignore otherwise."
    : "";

  const merged: ChatInput = {
    ...input,
    extraPreamble: [input.extraPreamble, memoryBlock].filter(Boolean).join("\n\n---\n\n") || undefined,
  };

  // 2. Run the actual turn
  const result = await chatReplyViaHermes(merged);
  if (!result.ok) return result;

  // 3. Write the turn to every tier in parallel (best-effort, async)
  const writeBoth = async () => {
    const meta = { turn_at: new Date().toISOString(), chat_id: input.chatId };
    await Promise.allSettled([
      writeMemory({
        organizationId: input.organizationId,
        agentId: input.agentId ?? "default",
        userId: input.callerUserId ?? null,
        session,
        role: "user",
        content: input.userMessage,
        metadata: meta,
      }),
      writeMemory({
        organizationId: input.organizationId,
        agentId: input.agentId ?? "default",
        userId: input.callerUserId ?? null,
        session,
        role: "assistant",
        content: result.reply,
        metadata: meta,
      }),
    ]);
  };
  void writeBoth();

  return { ok: true, reply: result.reply, learned: snippets.length };
}

/* -------------------------------------------------------------------- */
/* Self-healing: detect error, run autoresearch loop until clean         */
/* -------------------------------------------------------------------- */

export interface SelfHealOptions {
  maxCycles?: number;
  patience?: number;
  egl?: number;
}

export async function withErrorRepairLoop(
  input: ChatInput,
  opts: SelfHealOptions = {},
): Promise<AgentChatResult> {
  const maxCycles = opts.maxCycles ?? 3;
  const patience = opts.patience ?? 2;
  const egl = opts.egl ?? 0.05;
  const session = `org:${input.organizationId}:chat:${input.chatId}`;

  // First attempt: regular turn
  const first = await chatReplyViaHermes(input);
  if (first.ok && !looksLikeError(first.reply)) {
    return { ok: true, reply: first.reply, healed: false };
  }

  // Run the autoresearch loop where each cycle re-asks Hermes with an
  // augmented prompt (prior failure + ask for a clean version) and we
  // score by errorScore. Keep the best score.
  const failedText = first.ok ? first.reply : first.error;

  const result = await autoresearch<string>(
    {
      goal: `Reply to: ${input.userMessage}\nThe first attempt produced this failed output: ${failedText}\nProduce a clean reply that does not contain any error / exception / unavailable / not-found / HTTP error wording.`,
      maxCycles,
      patience,
      egl,
    },
    {
      async propose(best, history) {
        const lastTried = (best ?? failedText).slice(0, 600);
        const augmentedInput: ChatInput = {
          ...input,
          extraPreamble: [
            input.extraPreamble ?? "",
            "## Self-healing context",
            `The previous attempt produced an error or partial output: "${lastTried}".`,
            history.length > 0
              ? `Tried ${history.length} repair iteration(s) so far without converging. Try a different angle this time.`
              : "Try a different angle: rephrase, add context, retry the tool with adjusted args, or admit limits without an error code.",
          ]
            .filter(Boolean)
            .join("\n"),
        };
        const r = await chatReplyViaHermes(augmentedInput);
        return r.ok ? r.reply : `[chat failed: ${r.error}]`;
      },
      async evaluate(candidate) {
        const score = errorScore(candidate);
        return { score, detail: looksLikeError(candidate) ? "still errory" : "clean" };
      },
    },
  );

  if (!result.best) {
    return { ok: false, error: "self-heal: no candidate produced" };
  }

  // Write the diagnostic so the same failure mode is recognized later
  void writeMemory({
    organizationId: input.organizationId,
    agentId: input.agentId ?? "default",
    userId: input.callerUserId ?? null,
    session,
    role: "system",
    content: `Self-heal: user said "${input.userMessage}". First attempt failed with: ${failedText.slice(0, 200)}. Recovered after ${result.cycles} cycle(s) with: ${result.best.slice(0, 200)}.`,
    metadata: { self_heal: true, cycles: result.cycles, score: result.bestScore },
  });

  return { ok: true, reply: result.best, healed: true, cycles: result.cycles };
}

/* -------------------------------------------------------------------- */
/* Compose both: self-learning + self-healing                            */
/* -------------------------------------------------------------------- */

export async function chatReplySelfHealingLearning(
  input: ChatInput,
): Promise<AgentChatResult> {
  const learned = await withMemoryContext(input);
  if (!learned.ok) {
    // If even the memory-wrapped turn failed, try the repair loop
    return withErrorRepairLoop(input);
  }
  if (looksLikeError(learned.reply)) {
    return withErrorRepairLoop(input);
  }
  return learned;
}

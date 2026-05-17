"use client";

import { useMemo } from "react";
import { humanizeJargon } from "./jargon";

/**
 * Render-side humanization hook for chat-history loads per
 * [B 03:11 → C] P5.
 *
 * Background: HOTFIX 30 (sha e8106ae) fixed the persistence
 * leak by making the chat route persist RAW reply text to
 * rgaios_agent_chat_messages + humanize ONLY at SSE emit. That
 * was right for the streaming surface but left a gap: history
 * RE-LOADS from the DB (page refresh, agent switch, /agents
 * navigation) bypass the SSE pipeline entirely - they read the
 * persisted RAW row directly. Operator then sees the un-
 * humanized tool name / Pedro / FLEX MODE in the message list.
 *
 * This hook wraps every persisted message field with
 * humanizeJargon at render time. Persistence stays RAW (so the
 * next-turn agent context still sees canonical enum names per
 * HOTFIX 30); the operator-facing UI sees the humanized form.
 *
 * useMemo keys on the raw input so re-renders of the same row
 * don't re-walk the JARGON_MAP.
 */

export type ChatMessageLike = {
  content: string | null;
  reasoning?: string | null;
  thinking?: string | null;
  [k: string]: unknown;
};

export function useHumanizedField(raw: string | null | undefined): string {
  return useMemo(() => (raw ? humanizeJargon(raw) : ""), [raw]);
}

export function useHumanizedMessage<T extends ChatMessageLike>(msg: T): T {
  // useMemo on the message identity (caller passes the same row obj
  // across re-renders of the same list) so the spread + humanize
  // pass runs once per row, not once per render.
  return useMemo(
    () => ({
      ...msg,
      content: msg.content ? humanizeJargon(msg.content) : msg.content,
      reasoning:
        typeof msg.reasoning === "string"
          ? humanizeJargon(msg.reasoning)
          : msg.reasoning,
      thinking:
        typeof msg.thinking === "string"
          ? humanizeJargon(msg.thinking)
          : msg.thinking,
    }),
    [msg],
  );
}

/**
 * Pure-function variant. Same per-field humanize as the hook,
 * but with no React dep so it works in server components, e2e
 * walks, and the unit spec.
 */
export function humanizeMessageFields<T extends ChatMessageLike>(msg: T): T {
  return {
    ...msg,
    content: msg.content ? humanizeJargon(msg.content) : msg.content,
    reasoning:
      typeof msg.reasoning === "string"
        ? humanizeJargon(msg.reasoning)
        : msg.reasoning,
    thinking:
      typeof msg.thinking === "string"
        ? humanizeJargon(msg.thinking)
        : msg.thinking,
  };
}

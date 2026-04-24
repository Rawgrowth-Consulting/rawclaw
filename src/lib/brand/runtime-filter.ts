import { BANNED_WORDS } from "./tokens";

/**
 * Runtime brand-voice guard. Build-time eslint-banned-words.mjs catches
 * source literals; this function catches LLM-generated text that reaches
 * user-facing surfaces at request time. Applied to:
 *   - telegram_reply (src/lib/mcp/tools/telegram.ts): before sending
 *   - any future outbound copy tool that lands in Slack/email/chat
 *
 * Behaviour:
 *   - scan the text once, case-insensitive, word-boundary aware
 *   - if any banned word hits, return { ok:false, hits, rewritten }
 *     where `rewritten` is the text with each hit replaced by a neutral
 *     stand-in so the caller can either ship the rewrite, regenerate
 *     upstream, or surface an alert to the operator channel
 */

const REPLACEMENTS: Record<string, string> = {
  "game-changer": "big deal",
  unlock: "open",
  leverage: "use",
  utilize: "use",
  "deep dive": "close look",
  revolutionary: "new",
  "cutting-edge": "current",
  synergy: "fit",
  streamline: "simplify",
  empower: "equip",
  certainly: "yes",
};

function buildPattern() {
  const escaped = BANNED_WORDS.map((w) =>
    w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"),
  );
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

const PATTERN = buildPattern();

export type BrandFilterResult =
  | { ok: true }
  | {
      ok: false;
      hits: string[];
      rewritten: string;
    };

export function checkBrandVoice(text: string): BrandFilterResult {
  const hits = new Set<string>();
  let rewritten = text;

  rewritten = text.replace(PATTERN, (match) => {
    const lower = match.toLowerCase();
    hits.add(lower);
    const repl = REPLACEMENTS[lower] ?? "";
    // Preserve casing of the first char so the result reads naturally.
    if (!repl) return match;
    if (match[0] === match[0].toUpperCase()) {
      return repl[0].toUpperCase() + repl.slice(1);
    }
    return repl;
  });

  if (hits.size === 0) return { ok: true };
  return { ok: false, hits: [...hits], rewritten };
}

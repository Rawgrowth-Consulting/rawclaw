/**
 * Pure scoring helpers for the self-healing loop. Zero imports so unit
 * tests can run without pulling the Next.js / Supabase / Hermes
 * dependency graph (see tests/unit/self-healing.spec.ts).
 *
 * Mirrored on the Python side by `self_heal_score` in
 * services/mcp-memory/server.py — keep the two implementations
 * algorithmically identical so the agent gets the same score whether
 * it calls the MCP tool or the TypeScript wrapper.
 */

export const ERROR_SIGNATURES: RegExp[] = [
  /\berror\b/i,
  /\bexception\b/i,
  /\btraceback\b/i,
  /\bfail(ed|ure)?\b/i,
  /\bunavailable\b/i,
  /\bnot found\b/i,
  /401\b/,
  /403\b/,
  /5\d{2}\b/,
];

export function looksLikeError(text: string): boolean {
  if (!text || text.length < 5) return true;
  return ERROR_SIGNATURES.some((re) => re.test(text));
}

export function errorScore(text: string): number {
  if (!text) return 0;
  const length = Math.min(text.length / 200, 1);
  const hasError = ERROR_SIGNATURES.some((re) => re.test(text)) ? 0 : 1;
  return length * 0.3 + hasError * 0.7;
}

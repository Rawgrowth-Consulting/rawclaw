/**
 * Autoresearch loop adapter for Hermes.
 *
 * Implements the Karpathy-style edit -> eval -> keep/revert -> repeat
 * loop pattern from autoresearch-anything (zkarimi22/autoresearch-anything,
 * generates setup.md instructions for AI coding agents). This is the
 * runtime version: invoke it from server code to drive a Hermes agent
 * iteratively against a measurable goal until the metric plateaus or
 * `maxCycles` is hit.
 *
 * Use cases inside the dashboard:
 *   - "Improve this agent's brand-voice score on the last 50 replies"
 *     drives a loop that edits the profile soul (system_prompt), evals
 *     against a sample, keeps the edit if score improves.
 *   - "Tune this Composio tool prompt until the JSON output validates 95%"
 *     drives a loop that mutates the tool wrapper prompt, runs the
 *     validator, keeps the mutation that breaks the score plateau.
 *   - "Find a workflow ordering that gets all 5 client steps to green"
 *     drives the agent through reordering attempts.
 *
 * The loop is intentionally generic: caller supplies `propose`, `eval`,
 * and a state mutation surface; this module just runs the bookkeeping.
 */

import { hermesChat } from "@/lib/hermes/client";

export interface AutoresearchConfig {
  /** Hermes profile to drive the loop. */
  profile?: string;
  /** Maximum cycles before stopping. */
  maxCycles: number;
  /** Convergence: stop early if the best score has not improved in this
   *  many cycles. */
  patience: number;
  /** Minimum delta in score that counts as an improvement (epsilon). */
  egl: number;
  /** Goal description; passed to the proposer prompt. */
  goal: string;
}

export interface AutoresearchObservation<T> {
  candidate: T;
  score: number;
  detail?: string;
}

export interface AutoresearchHooks<T> {
  /** Generate the next candidate state given the current best + history.
   *  Typically a Hermes chat that returns a structured suggestion. */
  propose: (
    best: T | null,
    history: AutoresearchObservation<T>[],
  ) => Promise<T>;
  /** Apply the candidate to the world, run the evaluation, return a
   *  score (higher = better) and a free-form detail string. */
  evaluate: (candidate: T) => Promise<{ score: number; detail?: string }>;
  /** Optional revert hook called whenever a candidate is rejected. */
  revert?: (candidate: T) => Promise<void>;
}

export interface AutoresearchResult<T> {
  best: T | null;
  bestScore: number;
  cycles: number;
  converged: boolean;
  history: AutoresearchObservation<T>[];
}

/**
 * Run the edit -> eval -> keep/revert loop.
 *
 *   for cycle in [1..maxCycles]:
 *     candidate = propose(best, history)
 *     score, detail = evaluate(candidate)
 *     if score > bestScore + egl:
 *       best, bestScore = candidate, score
 *       sinceImproved = 0
 *     else:
 *       revert?(candidate)
 *       sinceImproved += 1
 *     if sinceImproved >= patience: stop
 */
export async function autoresearch<T>(
  config: AutoresearchConfig,
  hooks: AutoresearchHooks<T>,
): Promise<AutoresearchResult<T>> {
  const history: AutoresearchObservation<T>[] = [];
  let best: T | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let sinceImproved = 0;

  for (let cycle = 1; cycle <= config.maxCycles; cycle++) {
    const candidate = await hooks.propose(best, history);
    const { score, detail } = await hooks.evaluate(candidate);
    const obs: AutoresearchObservation<T> = { candidate, score, detail };
    history.push(obs);

    if (score > bestScore + config.egl) {
      best = candidate;
      bestScore = score;
      sinceImproved = 0;
    } else {
      if (hooks.revert) await hooks.revert(candidate);
      sinceImproved += 1;
    }

    if (sinceImproved >= config.patience) {
      return { best, bestScore, cycles: cycle, converged: true, history };
    }
  }
  return {
    best,
    bestScore,
    cycles: config.maxCycles,
    converged: false,
    history,
  };
}

/**
 * Convenience proposer: ask a Hermes profile to "improve this candidate"
 * given the goal + best-so-far + recent history. Returns the agent's
 * suggested next candidate (as a string; caller parses it).
 *
 * Pattern matches the autoresearch-anything setup.md prompt template:
 *   "Here is the goal: <goal>. The best score so far is <bestScore>.
 *    Recent attempts: <history>. Propose a single concrete edit that
 *    might break the plateau. Output only the new candidate value."
 */
export async function proposeViaHermes(args: {
  profile: string;
  goal: string;
  best: string | null;
  bestScore: number;
  history: AutoresearchObservation<string>[];
}): Promise<string> {
  const tail = args.history.slice(-5).map(
    (h, i) => `  attempt ${i + 1}: score=${h.score.toFixed(3)} candidate=${truncate(h.candidate, 200)}`,
  );
  const prompt = [
    `Goal: ${args.goal}`,
    `Best score so far: ${args.bestScore.toFixed(3)}`,
    args.best ? `Best candidate so far: ${truncate(args.best, 400)}` : `No candidate yet, propose the initial one.`,
    "Recent attempts:",
    tail.join("\n"),
    "",
    "Propose ONE concrete next candidate value that might improve the score.",
    "Output the candidate verbatim, no commentary, no markdown fences.",
  ].join("\n");

  const { reply } = await hermesChat({
    prompt,
    profile: args.profile,
  });
  return reply.trim();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "..." : s;
}

/**
 * Evaluator-role spike per [B 02:14 → C] + [B 01:34] Anthropic
 * Planner / Generator / Evaluator triad research.
 *
 * Hypothesis: an evaluator role that scores the generator's
 * artifact against explicit criteria, then asks the generator to
 * refine, converges on a higher-quality output in fewer total
 * tokens than the current "generate once, hope it's good" path.
 *
 * Read-only spike. NO production wiring. NO new MCP tool. Just a
 * pure-function harness so the unit spec can prove the contract
 * + a stub doc explaining how to wire it once we promote.
 *
 * Outputs from a tick:
 *   - finalArtifact: the last generator output
 *   - finalScore:    the last evaluator score
 *   - cycles:        how many generate+evaluate rounds ran
 *   - tokensUsed:    rough sum of prompt + completion tokens per
 *                    call (estimated by callers)
 *   - convergedAt:   the cycle index where score crossed threshold
 *                    (null if never converged)
 */

export type EvaluatorVerdict = {
  score: number; // 0-100
  breaches: string[];
  suggestedFix: string;
};

export type GeneratorFn = (
  spec: string,
  priorArtifact: string | null,
  priorVerdict: EvaluatorVerdict | null,
) => Promise<{ artifact: string; tokens: number }>;

export type EvaluatorFn = (
  spec: string,
  artifact: string,
) => Promise<{ verdict: EvaluatorVerdict; tokens: number }>;

export type CycleOptions = {
  maxCycles?: number;
  threshold?: number;
};

export const EVALUATOR_DEFAULTS = {
  maxCycles: 5,
  threshold: 90,
} as const;

/**
 * Critique prompt the evaluator should use when integrating into a
 * real LLM call. Returned as a const string so the unit spec can
 * assert it stays free of operator-facing leaks and the production
 * wrapper (when promoted) imports the same source of truth.
 */
export const EVALUATOR_CRITIQUE_PROMPT = `
You are evaluating an artifact against a specification.

Return JSON:
{
  "score": 0-100,
  "breaches": [string],
  "suggestedFix": string
}

Score 100 = artifact fully meets spec. Score 0 = unrelated.
List every concrete breach. The suggestedFix is one short
sentence the generator can act on without re-reading the spec.
`.trim();

export type CycleResult = {
  finalArtifact: string;
  finalScore: number;
  cycles: number;
  tokensUsed: number;
  convergedAt: number | null;
  history: Array<{
    cycle: number;
    artifact: string;
    score: number;
    tokens: number;
  }>;
};

/**
 * Run the spec → generate → evaluate → refine loop.
 *
 * - maxCycles caps the loop so a stubborn evaluator can't burn
 *   unbounded tokens.
 * - threshold is the score (inclusive) where we stop and ship.
 * - Each round invokes generator once, then evaluator once.
 * - Token cost is the sum of every call's reported tokens.
 */
export async function runEvaluatorCycle(
  spec: string,
  generator: GeneratorFn,
  evaluator: EvaluatorFn,
  options: CycleOptions = {},
): Promise<CycleResult> {
  const maxCycles = options.maxCycles ?? EVALUATOR_DEFAULTS.maxCycles;
  const threshold = options.threshold ?? EVALUATOR_DEFAULTS.threshold;

  let artifact = "";
  let verdict: EvaluatorVerdict | null = null;
  let tokensUsed = 0;
  let convergedAt: number | null = null;
  const history: CycleResult["history"] = [];

  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    const gen = await generator(spec, artifact || null, verdict);
    artifact = gen.artifact;
    tokensUsed += gen.tokens;

    const evalRes = await evaluator(spec, artifact);
    verdict = evalRes.verdict;
    tokensUsed += evalRes.tokens;

    history.push({
      cycle,
      artifact,
      score: verdict.score,
      tokens: gen.tokens + evalRes.tokens,
    });

    if (verdict.score >= threshold) {
      convergedAt = cycle;
      break;
    }
  }

  return {
    finalArtifact: artifact,
    finalScore: verdict?.score ?? 0,
    cycles: history.length,
    tokensUsed,
    convergedAt,
    history,
  };
}

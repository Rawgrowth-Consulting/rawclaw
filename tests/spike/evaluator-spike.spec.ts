import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EVALUATOR_CRITIQUE_PROMPT,
  EVALUATOR_DEFAULTS,
  runEvaluatorCycle,
  type EvaluatorFn,
  type EvaluatorVerdict,
  type GeneratorFn,
} from "../../src/lib/agent/__experiments__/evaluator-spike";

/**
 * Spike tests for the evaluator-role prototype. The generator +
 * evaluator are stubs so the harness contract is asserted in
 * isolation from any real model call.
 */

function fixedGenerator(text: string, tokens = 100): GeneratorFn {
  return async () => ({ artifact: text, tokens });
}

function scoreSequenceEvaluator(
  scores: number[],
  tokens = 50,
): EvaluatorFn {
  let i = 0;
  return async () => {
    const score = scores[Math.min(i, scores.length - 1)];
    i += 1;
    const verdict: EvaluatorVerdict = {
      score,
      breaches: score >= 90 ? [] : ["too short", "missing rubric"],
      suggestedFix: score >= 90 ? "" : "add the missing rubric line",
    };
    return { verdict, tokens };
  };
}

test("defaults: maxCycles 5, threshold 90", () => {
  assert.equal(EVALUATOR_DEFAULTS.maxCycles, 5);
  assert.equal(EVALUATOR_DEFAULTS.threshold, 90);
});

test("EVALUATOR_CRITIQUE_PROMPT is operator-clean (no banned vocab)", () => {
  const p = EVALUATOR_CRITIQUE_PROMPT;
  const banned = ["Pedro", "FLEX MODE", "shared memory", "tool_call", "MCP"];
  for (const b of banned) {
    assert.ok(!p.includes(b), `prompt should not include "${b}"`);
  }
  assert.match(p, /score/i);
  assert.match(p, /breaches/);
  assert.match(p, /suggestedFix/);
});

test("converges on first pass when score >= threshold", async () => {
  const result = await runEvaluatorCycle(
    "produce X",
    fixedGenerator("X done", 100),
    scoreSequenceEvaluator([95], 50),
  );
  assert.equal(result.convergedAt, 1);
  assert.equal(result.cycles, 1);
  assert.equal(result.finalScore, 95);
  assert.equal(result.tokensUsed, 150);
});

test("loops until score crosses threshold", async () => {
  const result = await runEvaluatorCycle(
    "produce X",
    fixedGenerator("X done", 100),
    scoreSequenceEvaluator([60, 75, 92], 50),
  );
  assert.equal(result.convergedAt, 3);
  assert.equal(result.cycles, 3);
  assert.equal(result.finalScore, 92);
  assert.equal(result.tokensUsed, 3 * 150);
});

test("stops at maxCycles even if never converges", async () => {
  const result = await runEvaluatorCycle(
    "produce X",
    fixedGenerator("X partial", 100),
    scoreSequenceEvaluator([50, 50, 50, 50, 50, 50], 50),
    { maxCycles: 3 },
  );
  assert.equal(result.convergedAt, null);
  assert.equal(result.cycles, 3);
  assert.equal(result.finalScore, 50);
});

test("custom threshold honored", async () => {
  const result = await runEvaluatorCycle(
    "produce X",
    fixedGenerator("X", 100),
    scoreSequenceEvaluator([70, 75], 50),
    { threshold: 70 },
  );
  assert.equal(result.convergedAt, 1);
});

test("history captures every cycle in order", async () => {
  const result = await runEvaluatorCycle(
    "produce X",
    fixedGenerator("X", 100),
    scoreSequenceEvaluator([40, 60, 95], 50),
  );
  assert.equal(result.history.length, 3);
  assert.equal(result.history[0].score, 40);
  assert.equal(result.history[1].score, 60);
  assert.equal(result.history[2].score, 95);
});

test("passes prior artifact + verdict back into generator on refine", async () => {
  const seen: Array<{ prior: string | null; v: EvaluatorVerdict | null }> = [];
  const gen: GeneratorFn = async (_spec, priorArtifact, priorVerdict) => {
    seen.push({ prior: priorArtifact, v: priorVerdict });
    return { artifact: "draft-" + (seen.length), tokens: 10 };
  };
  await runEvaluatorCycle(
    "produce X",
    gen,
    scoreSequenceEvaluator([50, 95], 10),
  );
  assert.equal(seen.length, 2);
  assert.equal(seen[0].prior, null);
  assert.equal(seen[0].v, null);
  assert.equal(seen[1].prior, "draft-1");
  assert.ok(seen[1].v);
  assert.equal(seen[1].v?.score, 50);
});

test("token count = sum of generator + evaluator tokens across cycles", async () => {
  const result = await runEvaluatorCycle(
    "produce X",
    fixedGenerator("X", 200),
    scoreSequenceEvaluator([60, 95], 80),
  );
  assert.equal(result.tokensUsed, 2 * 280);
});

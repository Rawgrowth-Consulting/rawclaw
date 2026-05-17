# Spike: evaluator-role prototype

Dispatched by [B 02:14 → C], grounded in [B 01:34] Anthropic
multi-agent research (Planner / Generator / Evaluator triad).

## Hypothesis

Adding an evaluator role that scores the generator's artifact
against explicit criteria, then asks the generator to refine,
converges on a higher-quality output in fewer total tokens than
the current "generate once, hope it's good" path used by every
chat turn today.

## What's in the spike

| File | Purpose |
|---|---|
| `src/lib/agent/__experiments__/evaluator-spike.ts` | Pure-function cycle harness + critique prompt + types. NO production wiring. NO LLM call - the generator + evaluator are injected fns. |
| `tests/spike/evaluator-spike.spec.ts` | Stubbed generator + scripted score sequence. Verifies convergence within N cycles, exit-on-threshold, token accounting, refine feedback round-trip. |

Both live under `__experiments__/` + `tests/spike/` so the
production build path doesn't accidentally pull the spike into a
real flow.

## How to wire it (when / if promoted)

1. Replace `fixedGenerator` with a wrapper around the real chat
   generation call (chat route or telegram route).
2. Replace `scoreSequenceEvaluator` with an LLM call that uses
   `EVALUATOR_CRITIQUE_PROMPT` as the system prompt and the spec
   + artifact as the user message.
3. Call `runEvaluatorCycle` from the route once per outbound
   response. Persist the `history` to `rgaios_audit_log` for
   later analysis.

## Measurement plan (before promote)

Run the cycle against a fixed bench of 10 R-MARTI walks. Compare:

| Metric | Single-pass baseline | Evaluator cycle |
|---|---|---|
| Avg walk score (0-100) | TBD | TBD |
| Avg tokens per walk | TBD | TBD |
| p95 cycles to converge | n/a | TBD |
| Walks reaching >= 90 | TBD | TBD |

## Decision criteria

Ship to production if:

- Convergence within **3 cycles** for at least 80% of walks
- Token cost **< 1.5x** single-pass baseline
- Walk score uplift **>= 10 points** average

If not, document the gap + park the spike. Either way, do not
hand-roll the integration without B sign-off on the measurement
table above.

## Open questions

1. Should the evaluator share the same model as the generator, or
   downshift to a cheaper one for cost?
2. Is the right "spec" the operator's original message, or a
   distilled task summary?
3. How do we plumb the cycle history into the operator-facing
   reasoning chip without leaking the developer-facing critique
   text? (Probably: surface only the final artifact + a one-line
   "refined N times" badge.)

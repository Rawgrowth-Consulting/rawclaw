# `tests/canonical/` — operator-visible regression suite

This folder turns the 32+ manually-captured canonical PNGs from the
Rawclaw v3 trial into reproducible Playwright specs. The point: if
a future deploy silently regresses humanizer / SSE / preamble /
tool-name-leak behavior, **CI flips red instead of a human noticing
six days later when a screenshot looks off**.

## Naming

One spec per canonical walk, named `R-<AGENT>-<TAG>.spec.ts`.

| File | Walk |
|---|---|
| `R-MARTI-CANONICAL.spec.ts` | Marta (Research) top-10-reels from `martifox.official`, last 30 days |

Add new walks by copying the seed spec and changing the prompt +
assertions. Keep one walk per file - it makes flake isolation +
parallel runs trivial.

## Required env

| Var | Purpose | Default |
|---|---|---|
| `E2E_BASE_URL` | Target VPS (dev / staging / dogfood) | `http://127.0.0.1:3002` |
| `E2E_USER` | Admin email (pedro@admin in trial fixtures) | hardcoded TODO fallback |
| `E2E_PASS` | Admin password | hardcoded TODO fallback |
| `E2E_MARTA_AGENT_ID` | Marta's agent uuid in the InstaCEO Academy org | unset → test skips |
| `GITHUB_RUN_ID` | Used to suffix screenshot filenames in CI | `Date.now()` fallback |

CI must set `E2E_USER` + `E2E_PASS` via GitHub Secrets before
merging this suite to v3. The hardcoded fallback exists only so a
local checkout can scaffold-run against a seeded dev DB - it is not
production-safe.

`E2E_MARTA_AGENT_ID` is intentionally unset by default because
Marta's uuid lives in the seeded fixture, not source. Set it once
per environment (export in CI workflow + add to your local `.env`
if you want to run these locally).

## Adding a new canonical spec

1. Capture the manual walk PNG you want to lock. File it under
   `docs/canonical-walks/` as the reference image.
2. Copy `R-MARTI-CANONICAL.spec.ts` to `R-<AGENT>-<TAG>.spec.ts`.
3. Replace:
   - `MARTA_AGENT_ID` env var name → the agent you're targeting
   - `CANONICAL_PROMPT` → the exact prompt from the walk
   - the assertion block (numbered list, banned strings, etc.) to
     match what your reference PNG shows
4. Keep the 5 baseline assertions every spec must include:
   - no em-dash (`—`) in the operator reply
   - no raw tool-name literals (e.g. `apify/`, `actor_id`,
     `composio_`, `agents_update`)
   - no raw `{tool ...}` JSON dict leak
   - reply shape matches the walk (list count, sections, etc.)
   - screenshot saved to `test-results/R-<AGENT>-<TAG>-<run-id>.png`
5. Run locally once to confirm. Commit + PR.

## Shared helpers

If a helper is reused across two specs, extract it to
`tests/canonical/_shared.ts`. Keep the specs themselves dumb and
readable - the value of this suite is that a human can read one
file and understand exactly which walk it locks.

For the deeper `BANNED_OPERATOR_TOKENS` list + apify fixture stub,
see the older scaffold at `tests/e2e/r-marti-canonical.spec.ts`.
That file is the unit-level guardrail; this folder is the UI-level
walk replay.

## Why a separate folder

`tests/` already mixes API smokes, unit specs, and e2e fixmes. The
canonical suite has a different operational contract:

- runs against a live VPS (not jsdom, not a mock)
- one round-trip per spec (cost-sensitive)
- failure = a human-visible regression, not a code-style issue
- gated by CI secrets, not just a passing `npm run test:unit`

Keeping it in its own folder lets CI run it in a dedicated job with
the right secrets + retries + cost budget, without dragging the
fast unit suite along.

# Operator-Facing Humanize Gateway Architecture

Living doc for the H-ARCH-1 → H-ARCH-5b architecture shipped
2026-05-17 to fix the long-running "raw tool name / Pedro /
FLEX MODE / file_name / agent_invoke" leak into Marti's chat
surface.

## Problem

The Marti operator chat leaked internal developer vocabulary
into every visible surface: tool names (`apify_top_reels_from_file`,
`agents_update`), arg syntax (`window_days=10 top_n=10`), infra
terms (`Claude Max quota exhausted`, `/connections`), agent
identifiers (`Pedro`, `FLEX MODE`, `shared memory`), persisted
filenames (`creator-list.csv`, `Kasia's tasks`). 25+ hotfix
commits between H8 and H32 kept adding patterns to the
humanizer regex map, only to regress at the next render
surface that bypassed it (history reload, delegation card,
tool result panel).

Root cause: humanization was scattered across N call sites
with no enforced choke point. Persistence and rendering used
the same string, so adding a humanize call in one place left
the other surfaces leaking.

## Solution: Two-Layer Separation

```
┌─────────────────────┐    ┌────────────────────┐
│  Model / Tool out   │    │  Operator surface  │
└──────────┬──────────┘    └─────────▲──────────┘
           │                         │
           ▼                         │
   ┌───────────────┐                 │
   │ Persist RAW   │                 │
   │ (DB row)      │                 │
   └───────┬───────┘                 │
           │                         │
           └─────► humanizeJargon ───┘
                   at boundary
```

**Layer 1 - RAW persistence**: `rgaios_agent_chat_messages`
stores raw model output verbatim (tool names, args, errors).
The agent's next-turn context window reads from the same row
and needs the canonical enum names so `agent_invoke` /
`apify_top_reels_from_file` keep resolving against the tool
whitelist (HOTFIX 30 root cause - persisting the humanized
form broke the next-turn `tool_call` whitelist).

**Layer 2 - HUMANIZE at boundary**: every operator-visible
surface passes its raw payload through `humanizeJargon()` at
render time, never before. Five render surfaces, one mapper.

| Surface | Site | Hook |
|---|---|---|
| Live SSE stream | `src/app/api/agents/[id]/chat/route.ts` emit() gateway | H-ARCH-1 (sha 4987844) |
| Chat history reload | `src/components/agents/AgentChatTab.tsx` render | H-ARCH-Q2 (sha c56fdf3) |
| Reasoning chip / Telegram trace | `src/lib/agent/thinking.ts` extractThinking | HOTFIX 8 + H30 split |
| Notification bell | `src/components/notification-bell.tsx` + `<BellGrouped/>` | HOTFIX 15 + F-2 |
| Delegation card | `src/components/agents/AgentChatTab.tsx` command-card path | H-ARCH-5b (sha aa0b1a3) |

## Single Source of Truth

`src/lib/agent/jargon.ts` exports `humanizeJargon(raw)` plus a
read-only `JARGON_MAP` of ~85 pattern / replacement pairs.
Map is the only place to add or change a scrub. All five
render surfaces import from this module - adding a new
operator-visible surface only requires one line:
`import { humanizeJargon } from "@/lib/agent/jargon"`.

## Contract Specs (CI gate)

Every JARGON_MAP row has at least one assertion spec under
`tests/unit/jargon*.spec.ts`. Specs are organised by ship
event so a future regression points at the originating fix:

| Spec file | Coverage |
|---|---|
| `jargon.spec.ts` | Base humanizer mapper (15 tests) |
| `jargon-strip.spec.ts` | HOTFIX 24 strip patterns (9) |
| `jargon-h27.spec.ts` | HOTFIX 27 narrative scrubs (5) |
| `jargon-h-arch-1.spec.ts` | H-ARCH-1 SSE-emit + redact rules (8) |
| `jargon-h-arch-2.spec.ts` | H-ARCH-2 file/peer noun bans (11) |
| `jargon-h-arch-5.spec.ts` | H-ARCH-5 delegation-card scrubs (25) |
| `jargon-coverage-extend.spec.ts` | Bare-token leak guard (23 tool names) |

CI runs all of these as a dedicated `jargon-gate` job (P8c,
ci.yml). A humanizer regression flips one named light in the
PR UI instead of being buried inside the general `test` job.

## Walk Regression Suite (CI gate)

E2E contracts under `tests/e2e/`:

- `r-marti-canonical.spec.ts` - jargon-clean canonical 3-reel
  walk (tier 2 mocked + tier 3 fixme).
- `r-marti-tiers.spec.ts` - 3-tier suite per scenario
  (canonical / bottom-by-likes / multi-creator).
- `r-marti-h-arch-4-contract.spec.ts` - fixture-driven
  delegation contract for H-ARCH-4 auto-delegate path.
- `r-marti-delegate.spec.ts` - P8b delegation regression:
  `USER_CHOICE_QUESTION_PATTERNS` (EN+PL) ban, reel-count
  check, Kasia identity, apify mock-spy.

Tier 3 live walks remain `test.fixme()` until Claude Max
quota refills + a Marti-shaped seed fixture lands. The
assertion harness from each contract drives the live walk
once promoted - no code change at promotion.

## Known Gaps (open, owner-tagged)

- `jargon.ts:167` `/\b\/connections\b/g` - `\b` boundary
  doesn't match leading `/`. `/connections` still leaks in
  retry messages. One-line fix (lookaround). Flagged from
  `tests/unit/jargon-h-arch-5.spec.ts` inline. A/B lane.

## Operator-vocab principles (for future hotfixes)

1. Add to `JARGON_MAP`; don't inline scrub at a call site.
2. Add a coverage test before the patch ships. Test names
   pin the originating fix (`HOTFIX <N> contract`) so the
   CI failure rapidly traces to "what was this trying to
   prevent."
3. Persist RAW. If a downstream pipeline needs the humanized
   form (e.g. PDF export), call `humanizeJargon` at the
   export boundary, not at persist.
4. Test BOTH a positive (banned token → expected replacement)
   AND a negative (the banned token's bare substring left
   alone) AND idempotency (twice = once).
5. The five surfaces above own their humanize call. Don't
   wrap upstream; let each surface remain in charge of its
   own rendering.

## Spec & PR cross-reference

- F-9 admin telemetry: data-layer never humanized (raw is
  the truth for debug); admin /telemetry page renders raw
  intentionally.
- F-5 chat telemetry sink: same principle - raw persisted,
  admin renders raw (read-only debug surface).
- Notification bell groupings (F-2 PR #13): humanize on the
  bell dropdown + full `/notifications` page render. Raw
  rows in `rgaios_agent_chat_messages` untouched.

## Wins this night (2026-05-17, 00:00 → 03:30)

- 13 C PRs merged (F-2, F-5/F-7/F-9 backing, F-6, F-8,
  jargon-coverage-extend, apify-helpers, evaluator-spike,
  chat-trace-export, walk-regression scaffold + extend,
  H-ARCH-4 contract, filename-mask helper, thinking
  helpers, P8c jargon-gate CI).
- 9 hotfix waves shipped by A (H22 → H-ARCH-5b) consolidated
  into this gateway pattern.
- 80+ jargon assertions locked across 7 spec files.
- 15 e2e contracts + 3 fixture variants for tier-2 walks.

## Future work (queued)

- Promote tier-3 live walks once quota refills.
- Q1 org-level files (80 LOC migration) - find_file_owner +
  cross-agent file ownership table. Bundled with Q4.
- Q3 section-tagged preamble refactor (150 LOC tech debt).
- v2 apify.ts call-site swap to the helpers shipped in
  PR #15 + #18 (currently helpers exist; call sites still
  inline).
- v2 audit_log PARTITION BY RANGE monthly (F-6 v1 ships
  pruning only).

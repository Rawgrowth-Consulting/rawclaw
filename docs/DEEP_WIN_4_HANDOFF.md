# DEEP WIN 4 — Chat Preamble Registry Unify

Phase 1 + Phase 2 handoff. Closing milestone after 38 iters.

## Goal recap

Before this milestone the `buildAgentChatPreamble` function in
`src/lib/agent/preamble.ts` was a 1258-line monolith. Every new
context block meant inline surgery: edit the function body, thread
new args, hope you didn't break the brittle `\n\n` separator chain.
That coupling is what produced the "weird SaaS" feedback Chris flagged
in April — the wrong block leaked into the wrong surface because the
only place to decide what rendered was deep inside the builder.

DEEP WIN 4 replaces the monolith with a registry pattern. A block is a
metadata entry + a builder function. The composer picks blocks via a
budget + mode policy and concatenates outputs. Adding a block is now
"insert one JSON entry + one builder map line."

## Phases shipped

### Phase 0 — Pure-delegation wrappers + parity guard

- `buildAgentChatPreambleV2`, `buildTelegramPreambleV2` wrappers
  in `src/lib/agent/context.ts` that pass through to the original
  builder. Parity spec in `tests/unit/context-parity.spec.ts`
  asserts byte-for-byte equality across 3 agents × 4 modes.

### Phase 1a–1e — Per-block extraction (iters 1–19)

Each iter extracted one block from `preamble.ts` into its own exported
helper (`buildCapabilitiesAndTrustBlock`, `buildAtlasDirectivesBlock`,
etc.), preserving the original output byte-for-byte (parity test
guarded). The final iter 19 dropped the dead `legacy-tail` wrapper
once every emit site was extracted.

End state: 21 builder helpers in `preamble.ts`, all hit by the
composer in registry order.

### Phase 2 — Selector + scoring layer (iters 25–38)

- **iter 25**: `CHAT_BLOCKS` registry array + `ChatBlock` type
  (id, build, priority, defaultCostTokens, modes).
- **iter 25**: `selectChatBlocks(blocks, options)` — mode filter +
  budget gate on `priority: "skippable"` entries, required blocks
  always pass.
- **iter 27 + 29**: chat route + telegram webhook adopt
  `skippableBudgetTokens` (history-aware on chat, fixed lean on
  telegram).
- **iter 30**: per-mode block filter (`modes?: AgentContextMode[]`)
  so future telegram-specific drops land in the registry, not the
  callsite.
- **iter 32**: `describeSelection()` debug helper — pure inspector
  reporting selected + skipped (with reason: "mode" | "budget") +
  total token costs.
- **iter 33**: composer switches to `describeSelection` as single
  source of truth + `telemetry?: boolean` opt-in `console.info`
  emission when budget drops blocks.
- **iter 34**: `selectChatBlocks` DRY collapse — derives from
  `describeSelection.selected` so the two paths can't drift.
- **iter 35**: `tests/unit/chat-blocks-registry.spec.ts` pins the
  structural contract (unique ids, valid priority, non-negative
  cost, valid modes, size baseline).
- **iter 36**: `ROLE_BASED_BUDGET_POLICY` + `budgetPolicy?` hook on
  composer options. CEO 6000 / dept-head 4000 / specialist 2000.
  Single DB round-trip for capability flags.
- **iter 37**: metadata externalized to
  `src/lib/agent/chat-blocks.config.json`. Registry is a JOIN of
  JSON entries × typed builder map. Module init throws on id
  mismatch.
- **iter 38**: `Object.freeze` on the registry array + each entry
  so accidental runtime mutation throws under strict mode.

## Architecture (ASCII)

```
┌───────────────────────────────────────────────────────────────┐
│  src/lib/agent/chat-blocks.config.json    (ops-tunable)       │
│  [{id, priority, defaultCostTokens, modes?}, ...] × 21        │
└────────────────────┬──────────────────────────────────────────┘
                     │ import (resolveJsonModule)
                     ▼
┌───────────────────────────────────────────────────────────────┐
│  src/lib/agent/context.ts                                     │
│                                                               │
│  CHAT_BLOCK_BUILDERS: Record<id, (ctx) => string|null>        │
│  CHAT_BLOCKS = JOIN(json, builders) — Object.frozen           │
│                                                               │
│  selectChatBlocks(blocks, opts) ──derives──┐                  │
│                                            ▼                  │
│  describeSelection(blocks, opts)                              │
│    → { selected[], skipped[reason], totals }                  │
│                                            │                  │
│  composeChatPreamble(input, opts)          │                  │
│    1. compute capability flags (1 DB call) │                  │
│    2. apply budgetPolicy(flags) if set     │                  │
│    3. ask describeSelection what survives  │                  │
│    4. iterate CHAT_BLOCKS, render selected │                  │
│    5. emit console.info if telemetry + drop│                  │
└────────────────────┬──────────────────────────────────────────┘
                     │
   ┌─────────────────┴─────────────────┐
   ▼                                   ▼
┌──────────────────────┐    ┌──────────────────────────┐
│ src/app/api/agents/  │    │ src/app/api/webhooks/    │
│  [id]/chat/route.ts  │    │  agent-telegram/         │
│                      │    │  [botRowId]/route.ts     │
│ budgetPolicy =       │    │ budgetPolicy =           │
│  role base × history │    │  ROLE_BASED_BUDGET_POLICY│
│ telemetry: true      │    │ telemetry: true          │
└──────────────────────┘    └──────────────────────────┘
```

## How to add a new block

Three steps. End-to-end ~10 lines.

1. **Write the builder helper** in `src/lib/agent/preamble.ts`:

   ```ts
   export async function buildMyNewBlock(input: {
     orgId: string;
     priorContent: string;
   }): Promise<string | null> {
     // ... fetch data, format, return null if nothing to render
   }
   ```

2. **Add the metadata entry** in
   `src/lib/agent/chat-blocks.config.json`
   (placement in the array = render order):

   ```json
   { "id": "my-new-block", "priority": "skippable", "defaultCostTokens": 300 }
   ```

   Optional: `"modes": ["chat"]` to render only on a specific surface.

3. **Register the builder** in `CHAT_BLOCK_BUILDERS` in
   `src/lib/agent/context.ts`:

   ```ts
   "my-new-block": (ctx) =>
     buildMyNewBlock({ orgId: ctx.orgId, priorContent: ctx.priorContent }),
   ```

4. **Bump the size baseline** in
   `tests/unit/chat-blocks-registry.spec.ts` from `21` → `22`. The
   test is deliberately loud so the diff shows up.

If you forget step 3 the module init throws at first import; if you
forget step 4 the registry-validation spec fails. No silent dropouts.

## Bench numbers

Token-budget savings depend on which blocks the gate drops. Real
production numbers will land once telemetry from iter 33's
`console.info` emission is aggregated (see Phase 3 candidates).
Synthetic estimate: ~13.3k preamble unbudgeted vs ~6k under CEO
budget vs ~2k under specialist. Marti is a CEO-class bot, so most
chat threads see no drop until message count > 20.

## Debug usage

```ts
import { describeSelection, CHAT_BLOCKS } from "@/lib/agent/context";

const d = describeSelection(CHAT_BLOCKS, {
  mode: "telegram",
  skippableBudgetTokens: 2000,
});
// d.selected -> [{id, priority, cost}, ...]
// d.skipped  -> [{id, priority, cost, reason: "mode" | "budget"}, ...]
// d.totalSelectedCost, d.totalSkippedCost
```

Pure function, no DB hit, safe to call from anywhere (ops admin
pages, ad-hoc scripts, future telemetry collectors).

## Phase 3 candidates remaining

Deferred past DEEP WIN 4 close:

- **Telemetry analysis admin page**: query a new
  `rgaios_chat_telemetry` table for actual block-skip distribution
  under current budgets, surface in `/admin/telemetry`. Needs a
  migration first.
- **YAML pivot**: swap the JSON config to YAML when ops asks. One
  parser line (`yaml.parse` instead of `JSON.parse`) plus the
  `js-yaml` dep. JSON was picked for iter 37 to avoid the dep.
- **Per-route budget overrides in config**: lift the chat-route
  history scale factors (1.0 / 0.5 / 0.2 at 20/40 message
  breakpoints) into the JSON config so ops can tune without code.
- **Per-mode block annotations**: populate `modes` on heavy blocks
  (e.g. `atlas-directives`) that telegram doesn't need. Behavior
  change — needs a walk verification first.

## Test count

End-of-milestone: 257/257 unit tests passing.

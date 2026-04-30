# Rawclaw v3 — agent context

This file is referenced by CLAUDE.md and read on every Claude Code
session that touches the v3 repo. Single source of project context.

## What this repo is

Rawclaw v3 is a per-client VPS multi-agent orchestration product:
portal onboarding + dashboard + Telegram-driven agent loops, all on
one Next.js 16 app. Shared Supabase Cloud per fleet (RLS by
`organization_id`), per-VPS app + drain server.

Branch: `v3` on `Rawgrowth-Consulting/rawclaw`. PR-per-day cadence.

## Reference docs (live in `/home/pedroafonso/Downloads/`)

- `rawclaw-v3-cto-brief.pdf` — Chris's spec, 21 pages. §9 has the
  binary acceptance items the May 7 demo gates on.
- `Rawclaw v3 — Developer Brief (Pedro).pdf` — original brief Chris
  sent Apr 23. Same §9 acceptance items.
- `rawclaw-v3-day1-reply.md/pdf` — Pedro's Day-1 architecture
  proposal (Drop Convex → Supabase, hard caps, 3 risks).
- `rawclaw-v3-execution-plan.pdf` — D1-D14 plan with daily gates +
  R01-R09 risks + new R08 cross-tenant + R09 OpenAI dependency.
- `Pedro CTO Trial SOW - v2 redlined.md/pdf` — signed Apr 24,
  $2,000 binary completion bonus on §9 pass.

## Key product decisions (locked Apr 24)

1. Extend rawclaw on `v3` branch — no new repo, no fork.
2. Two-path runtime: Claude Code CLI primary (Path A) + Anthropic
   Commercial API fallback (Path B). One env var flips per VPS.
3. Shared Supabase per brief §2. RLS by `organization_id` from JWT.
   SQLite per-VPS planned for hot agent state (memory cache, spawn
   queue) — not load-bearing for trial; deferred.

Implicit defaults locked by the plan:
- Onboarding chat stays on OpenAI gpt-4o for trial. Anthropic swap
  parked post-trial.
- Knowledge tools re-enabled in self-hosted for per-agent RAG.
- Embedder = fastembed-js + BAAI/bge-small-en-v1.5 (384d → 1536d
  zero-padded). No API key required, fits CX22 RSS.

## Architecture quick map

- `src/app/` — Next.js 16 app router (portal + dashboard + APIs).
- `src/lib/llm/provider.ts` — multi-provider abstraction
  (anthropic-cli | anthropic-api | openai). Per-call-site env
  override.
- `src/lib/runs/{dispatch,executor}.ts` — routine execution.
  Dispatch branches isV3 → host-side rawclaw-drain on :9876;
  isSelfHosted → leaves pending for MCP runs_claim;
  hosted → in-process via `after()`.
- `src/lib/knowledge/embedder.ts` — fastembed default, openai +
  voyage as opt-in providers.
- `src/lib/brand/{tokens,runtime-filter,apply-filter}.ts` - brand
  voice + 11 banned words enforced at build time
  (eslint.config.mjs) + runtime. Filter applied at: telegram_reply
  (MCP), telegram_chat (both per-Department-Head and legacy webhook
  chat paths), slack_post_message, gmail_draft.
- `src/lib/mcp/tools/` - 35+ MCP tools registered in
  `src/lib/mcp/tools/index.ts`. v3 D3 added `company_query` for
  cross-corpus semantic search.
- `src/lib/auth/dept-acl.ts` - per-department visibility helpers
  (P1 #6). `getAllowedDepartments(ctx)` reads
  `rgaios_organization_memberships.allowed_departments` (migration
  0037). Empty array = no restriction. Admin always bypasses.
- `src/lib/agents/role-templates.ts` + `starter-content/` - 12+
  role-specific system prompts + framework markdown bundled in the
  repo. Hire flow + default seed auto-attach starter files +
  default skills + system_prompt to every new agent (P0 #3 + #4).
- `src/lib/knowledge/company-corpus.ts` (#7) - single
  cross-source corpus over intake / brand profile / scrape / sales
  calls / onboarding docs. Backed by `rgaios_company_chunks` table
  + `match_company_chunks` RPC.
- `supabase/migrations/0001-0043` - single source of truth for
  schema; `npm run self-hosted:migrate` is idempotent. Cloud
  applies via `scripts/apply-cloud-migrations.mjs`.
- `scripts/wire-supabase.sh` — one-shot wiring of a fresh Supabase
  project: writes `.env.production` + provisions `agent-files` +
  `knowledge` storage buckets.
- `scripts/provision-vps.sh` — fresh-droplet bootstrap (Caddy +
  Docker + drain-server.mjs at :9876 + rawclaw-tick.timer).
- `packages/brand/` — path-shape stubs re-exporting `src/lib/brand/`
  so plan §D3+§D12 doc paths resolve.

## Working norms

- Every change ships a commit with a clear "why". Multi-paragraph
  bodies for non-obvious work; one-line title for cosmetic.
- Smoke (`/tmp/v3-route-smoke.sh` or the in-repo equivalent) +
  `npm run test:unit` before push. CI re-runs both.
- Cloud-test against `rawclawv3` Supabase before claiming "works".
  Service-role key bypasses RLS — every API route gates on
  `getOrgContext()` first; `currentOrganizationId()` throws if no
  session (no Rawgrowth fallback).
- Em-dashes (`—`) banned per Pedro style + brief §12 voice rule.
  Use ` - ` or two sentences.
- Banned words list is frozen at 11: game-changer, unlock,
  leverage, utilize, deep dive, revolutionary, cutting-edge,
  synergy, streamline, empower, certainly. ESLint catches at build
  time, runtime filter catches in MCP tool output.

## Contacts

| Role | Name |
|---|---|
| CEO + final say | Chris West |
| AI COO + scope | Scan |
| Eng infra patterns | Ali |
| Client-facing copy | Dilan |
| Owner | Pedro Afonso |

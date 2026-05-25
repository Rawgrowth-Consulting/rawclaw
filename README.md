# Rawgrowth Rawclaw v4 (Hermes Agent migration)

> **You are on the `v4` branch.** Migration target: swap the home-grown rawclaw v3 runtime for **NousResearch Hermes Agent**. See `ARCHITECTURE-V4.md` for the new stack diagram and `HERMES-DEPLOY.md` for the per-VPS deployment recipe.
>
> **What is now wired (code, not yet smoke-tested in CI):**
>
> - `src/lib/hermes/client.ts` - typed HTTP client for the Hermes gateway: `hermesResponses({...})` with SSE event parsing, plus `hermesJobs` (cron-style scheduled prompts, replaces drain server) and `hermesProfiles` (per-agent system_prompt + skills + mcp config).
> - `src/lib/hermes/bridge.ts` - `chatReplyViaHermes()` translates the v3 chatReply contract to a streamed POST `/v1/responses`. Same `onStreamText` + `onToolUse` callback cadence so the Telegram streaming editor and the dashboard NDJSON consumer keep working unchanged.
> - `src/lib/agent/chat.ts` - rewritten as the single entry point. Builds the existing v3 preamble (RAG + brand voice + memory) via `buildAgentChatPreamble`, then routes to Hermes by default. `CHAT_ENGINE=v3-sdk` env flag falls back to the old SDK runner for rollback safety.
> - `scripts/sync-hermes-profiles.ts` - reads every `rgaios_agents` row for an org and upserts them as Hermes profiles via the gateway (idempotent, safe to re-run on every agent edit).
> - `docker-compose.v4.yml` + `docker/Caddyfile.v4` - new compose with only app + caddy. Hermes runs natively on the host as a systemd unit (installed by `hermes gateway install --system`); the Next.js container reaches it via `host.docker.internal:8642`. Drops local postgres + postgrest + drain server.
> - `.env.v4.example` - the four new env vars (`HERMES_GATEWAY_URL`, `HERMES_API_KEY`, `HERMES_DEFAULT_PROFILE`, `CHAT_ENGINE`) plus the v3 keys that still apply.
>
> **Sprint VPS state (2026-05-22):** five VPS running Hermes v0.14.0 (Admin + blair-prod + ccm-josh-prod + ccm-justin-prod + marti). Admin is fully wired (Codex 5.5 OAuth via Chris's ChatGPT, Composio MCP with seven tools, Google Calendar smoke test passed end-to-end). Blair Codex OAuth done. Marti Hermes installed; Telegram bot for Admin runs against Marti's bot token as a test rig until clients send their own. Remaining client deliverables (Composio `ck_` + Telegram tokens + OAuth windows) tracked in the sprint registry.
>
> **What is left for Rami on dashboard:** branded skin per client (Marti / Blair / CCM), Composio API integration for live numbers, the "Hire New Agent" section, and the chat surface refactor in `src/components/agents/AgentChatTab.tsx` to consume Hermes events from the bridge (the NDJSON event shape is unchanged, but the producer is now `chatReplyViaHermes` instead of `chatReplyViaSdk`).
>
> Below is the original v3 README, kept for reference until the dashboard rebuild lands.

---

# Rawgrowth AIOS (Rawclaw v3)

A per-client multi-agent operations platform. Each client runs an
isolated VPS hosting one Next.js 16 app that drives an org of AI agents
through onboarding, a dashboard, and a Telegram-native chat loop. State
lives in a shared Supabase Cloud fleet, isolated per client by
row-level security keyed to `organization_id`.

The product in one line: **a client DMs a Telegram bot and a CEO agent
orchestrates a department of specialists to get real work done.**

## How it works

**One bot per organization, wired to the CEO agent.** The CEO (e.g.
"Scan" on the Marti Fox deployment) receives every message and decides
how to handle it: answer directly, or delegate to the right specialist
(marketing / sales / customer-service / recruitment / research /
engineering). Operators never pick agents by hand.

For a multi-specialist ask the CEO runs a fan-out:

1. **Brief** — translate the operator's high-level request into a
   scoped task per specialist.
2. **Dispatch (parallel)** — fire N `agent_invoke` MCP calls in one
   turn with `wait:false`. Each returns instantly with a `run_id`, so
   the Claude Agent SDK dispatches them concurrently. The host drain
   server claims them in parallel (4 slots) and runs each as its own
   Claude Code subprocess.
3. **Collect** — `agent_invoke({ poll_run_ids: [...] })` polls every
   run in parallel server-side, returns partial within ~40s, and the
   CEO re-polls any still-pending ids (read-only, never a re-dispatch).
4. **Score + synthesize** — each output is scored 0-10 and woven into
   one executive answer. Failures are surfaced honestly; deliverables
   are never fabricated.

Agents *are* Claude Code instances: native tools (Bash, Read, Write,
Edit, WebSearch) plus additive MCP tools (Composio for Gmail/Slack/
Calendar/HubSpot, Apify scraping, per-agent RAG, agent messaging,
routines, approvals) served from the app's own `/api/mcp` endpoint.

## Architecture

- `src/app/` — Next.js 16 app router: portal onboarding, dashboard,
  API routes, Telegram + Composio webhooks.
- `src/lib/llm/provider.ts` — multi-provider abstraction
  (`anthropic-cli` | `anthropic-api` | `claude-max-oauth` | `openai`),
  per-call-site override via env.
- `src/lib/agent/` — the Claude Agent SDK runner (`sdk-runner.ts`,
  with an SDK pre-warm pool), chat surface (`chat-sdk.ts`), context +
  preamble builders, thinking/markup scrubbers.
- `src/lib/runs/{dispatch,executor}.ts` — routine execution. Dispatch
  branches by deploy mode: v3 → host drain server on :9876; self-hosted
  → MCP `runs_claim`; hosted → in-process.
- `src/lib/mcp/tools/` — 35+ MCP tools (`agent_invoke`, Composio,
  knowledge/RAG, telegram, routines, approvals, supabase, apify…),
  registered in `index.ts`.
- `src/lib/knowledge/` — fastembed (BAAI/bge-small) default embedder,
  per-agent + cross-corpus semantic search.
- `src/lib/brand/` — brand voice + the 11 banned words enforced at
  build time (eslint) and runtime (MCP output filter).
- `supabase/migrations/` — single source of truth for schema.
  `npm run self-hosted:migrate` is idempotent; cloud applies via
  `scripts/apply-cloud-migrations.mjs`. `0081` seeds the CEO agent's
  full orchestration system prompt.
- `scripts/provision-vps.sh` — fresh-droplet bootstrap (Caddy + Docker
  + drain server + minute tick timer).

Multi-tenant isolation is Supabase RLS keyed to the `organization_id`
claim in the NextAuth JWT. Service-role access is gated behind
`getOrgContext()` in every API route.

Deeper detail: [`ARCHITECTURE-V3.md`](./ARCHITECTURE-V3.md) (system
diagram, migrations, request traces) and
[`DEPLOY-V3.md`](./DEPLOY-V3.md) (fresh-droplet runbook). Agent-facing
conventions live in [`AGENTS.md`](./AGENTS.md).

## Telegram surface

- Live typing indicator held for the whole run.
- In-place progress placeholder with live dispatch counts
  (`🔧 4 dispatched · 2 done · synthesizing`).
- Automatic chunking of replies over Telegram's 4096-char cap into
  sequential `(i/N)` messages.

## Develop

```bash
npm install
npm run dev            # Next.js dev server
npm run test:unit      # node:test unit suite
npm run lint           # eslint incl. brand-voice + banned-word guards
npm run build          # production build
```

Self-hosted local stack (Postgres + PostgREST in Docker):

```bash
npm run self-hosted:bootstrap
npm run self-hosted:up
npm run self-hosted:migrate
```

## Deploy a client VPS

```bash
scripts/provision-vps.sh        # Caddy + Docker + drain + tick on a blank droplet
scripts/wire-supabase.sh        # provision the Supabase project + storage buckets
npm run client:cc-install       # install the rawgrowth MCP + slash commands for the CLI
```

claude-max-oauth boxes must leave `ANTHROPIC_API_KEY` empty — a stale
token in that slot overrides the bind-mounted Claude CLI OAuth
credential and breaks auth.

## Conventions

- Branch `v3` is trunk; PR-per-change cadence.
- Em-dashes are banned in agent output (brand voice). Use ` - ` or two
  sentences.
- Banned words (frozen at 11): game-changer, unlock, leverage, utilize,
  deep dive, revolutionary, cutting-edge, synergy, streamline, empower,
  certainly. ESLint catches them at build; the runtime filter catches
  them in MCP tool output.
- Smoke (`npm run test:smoke`) + unit (`npm run test:unit`) before push;
  CI re-runs both and rebuilds + deploys the per-client image on merge.

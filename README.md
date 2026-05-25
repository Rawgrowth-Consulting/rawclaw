# Rawgrowth Rawclaw v4 (Hermes Agent migration)

> **You are on the `v4` branch.** Migration target: swap the home-grown rawclaw v3 runtime for **NousResearch Hermes Agent**. See `ARCHITECTURE-V4.md` for the new stack diagram and `HERMES-DEPLOY.md` for the per-VPS deployment recipe.
>
> ## What is wired in this branch (code, scaffold-complete, not yet smoke-tested end to end)
>
> **Hermes dashboard client + chat bridge**
>
> - `src/lib/hermes/client.ts` - typed REST + WebSocket client for the actual Hermes 0.14 dashboard API (probed via `/openapi.json` and source at `hermes_cli/web_server.py`): `getStatus`, `hermesProfiles` (list / create / patch / soul / delete), `hermesJobs` (list / create / update / remove / pause / resume / trigger — replaces the v3 drain server), `hermesSessions` (read message history + delete), and `hermesChat({ prompt, profile, session, onEvent })` over the JSON-RPC WebSocket at `/api/ws`.
> - `src/lib/hermes/bridge.ts` - `chatReplyViaHermes()` keeps the v3 chatReply signature: same `onStreamText` + `onToolUse` callback cadence, deterministic session id `org:<orgId>:chat:<chatId>`, profile resolution `agentId -> rgaios_agents.name -> lowercased_underscored_name`, write-back mirror to `rgaios_agent_chat_messages` so the existing dashboard reader keeps working.
> - `src/lib/agent/chat.ts` - single entry point. Builds the v3 preamble (RAG + brand voice + memory) via `buildAgentChatPreamble`, then routes to Hermes by default. `CHAT_ENGINE=v3-sdk` env flag falls back to the legacy SDK runner for rollback.
>
> **Autoresearch loop (Karpathy-style edit -> eval -> keep/revert -> repeat)**
>
> - `src/lib/hermes/autoresearch.ts` - generic `autoresearch<T>({ goal, maxCycles, patience, egl }, { propose, evaluate, revert })` runtime that drives any candidate-state mutation loop against a measurable score. Built on the pattern from [`zkarimi22/autoresearch-anything`](https://github.com/zkarimi22/autoresearch-anything). Plus `proposeViaHermes()` convenience: ask a Hermes profile to propose the next candidate given the goal + best-so-far + recent history.
>
> **Memory tiers (pluggable, parallel write, fan-out read)**
>
> - `src/lib/memory/index.ts` - `writeMemory(turn)` / `readMemory(req)` with three pluggable adapters:
>   - `HermesLocalAdapter` - reads recent messages from Hermes's own SQLite via `/api/sessions/{id}/messages`. Default tier, no extra infra.
>   - `HonchoAdapter` - self-hosted Honcho REST against Supabase pgvector. Enabled by adding `honcho` to `MEMORY_TIERS` + setting `HONCHO_BASE_URL`. Provides user_models + summaries + facts on top of raw history.
>   - `Mem0Adapter` - mem0.ai SaaS (or self-hosted). Enabled by adding `mem0` to `MEMORY_TIERS` + `MEM0_API_KEY`. Episodic + procedural semantic memory.
>   - Chain configured via `MEMORY_TIERS="hermes,honcho,mem0"` env var; disabled tiers skip cleanly. Default is `hermes` only (v3-equivalent behavior).
>
> **Profile sync**
>
> - `scripts/sync-hermes-profiles.ts` - `ORG_ID=<uuid> tsx ...` reads every `rgaios_agents` row for an org and upserts each as a Hermes profile (system_prompt -> profile soul). Idempotent. Includes a small department -> default-skill-set heuristic.
>
> **Infrastructure**
>
> - `docker-compose.v4.yml` + `docker/Caddyfile.v4` - new compose with only `app` + `caddy`. Hermes runs natively on the host as a systemd unit; the Next.js container reaches both gateway (`:8642`) and dashboard (`:9119`) via `host.docker.internal`. Drops local postgres + postgrest + drain server. Caddyfile.v4 optionally proxies `/agent/*` to the Hermes dashboard if the client wants the agent reachable on the dashboard subdomain.
> - `.env.v4.example` - new env vars: `HERMES_DASHBOARD_URL`, `HERMES_DASHBOARD_TOKEN`, `HERMES_DEFAULT_PROFILE`, `CHAT_ENGINE`, `MEMORY_TIERS`, `HONCHO_BASE_URL`, `MEM0_API_KEY`, plus the v3 keys that still apply.
>
> ## Live proof on Admin VPS (2026-05-25, executed end to end)
>
> Every component below ran for real on the Admin VPS today, against the actual running infra.
>
> **Hermes subprocess invocation working.** `hermes chat -q "..." -Q` invoked from the VPS shell returned a real Codex 5.5 reply ("WIRE_TEST_OK 1779737014"). This is the path `chatReplyViaHermes` falls back to since Hermes 0.14 ships dashboard auth as a browser-only injected session token (`_SESSION_TOKEN = secrets.token_urlsafe(32)` regenerated each start, injected into the SPA HTML, source `hermes_cli/web_server.py:86`).
>
> **Hermes dashboard server-to-server unlocked.** Wrote `scrapeHermesDashboardToken()` in `src/lib/hermes/client.ts` that fetches the dashboard HTML once, regexes the 43-char URL-safe base64 token Hermes injects, and caches it. Live test: scraped token `HmHPAEGjvSO8JIIowNN9ys91kxsBqU5Sye0SFd2IpbM` → `GET /api/config` with `X-Hermes-Session-Token` header returned HTTP 200 OK (would be 401 without). The bridge's WebSocket chat path on `/api/ws` now has a working auth mechanism for headless callers; the subprocess path remains as fallback.
>
> **Honcho live + round-trip write/read proven.** `ghcr.io/plastic-labs/honcho:latest` running via `docker compose up -d` from the cloned `plastic-labs/honcho` repo with `pgvector/pgvector:pg15` swapped in for the bundled postgres + redis sidecar. All four containers healthy (`honcho-api-1`, `honcho-database-1`, `honcho-redis-1`, `honcho-deriver-1`). Healthcheck `GET http://127.0.0.1:8001/health` → `{"status":"ok"}`. Honcho v3 REST surface (37 endpoints) probed via `/openapi.json`. Wrote message via `POST /v3/workspaces/rgaios_smoke_test/sessions/smoke/messages` with body `{ messages: [{ peer_id: "agent_scan", content: "Marti likes pizza on Sundays" }] }` → returned message id `RPWNDjMdhlpWAyO5tZXuX`. Read back via `POST /v3/workspaces/.../sessions/smoke/messages/list` → same content + same id, persisted in Postgres. `HonchoAdapter` in `src/lib/memory/index.ts` uses this exact path with idempotent workspace/peer/session ensure-chain.
>
> **mem0 live + round-trip write/read proven.** `openmemory` (mem0 self-hosted MCP variant) running via `docker compose up -d --build` from the cloned `mem0ai/mem0` repo at `openmemory/`. Three containers up: `openmemory-mem0_store-1` (qdrant vector store), `openmemory-openmemory-mcp-1` (uvicorn FastAPI on :8765), `openmemory-openmemory-ui-1` (Next.js on :3000). Embedder + LLM running on local Ollama (installed via `curl -fsSL https://ollama.com/install.sh | sh`, `OLLAMA_HOST=0.0.0.0:11434` so the openmemory container reaches it via `host.docker.internal`, models `nomic-embed-text` for embeddings + `llama3.2:1b` for fact extraction). Qdrant collection `openmemory` configured with `embedding_model_dims: 768` (matching nomic-embed-text output). Wrote memory via `POST /api/v1/memories/` with body `{ user_id: "rawclaw", text: "Marti likes pizza on Sundays", app: "rawclaw" }` → returned 200 OK, qdrant `points_count: 1`. Read back via `GET /api/v1/memories/?user_id=rawclaw` → returned id `7e698363-5ff2-46f5-876d-e89878f87f29`, same content, app `rawclaw`. `Mem0Adapter` in `src/lib/memory/index.ts` uses this exact path, branches on self-hosted vs cloud SaaS.
>
> **Letta tier scaffolded.** `LettaAdapter` (formerly MemGPT, rebrand) committed as a fourth pluggable memory tier for `MEMORY_TIERS=hermes,honcho,mem0,letta`. Hits `POST /v1/agents/{agent_id}/archival` for writes, `GET .../archival?query=` for reads. Not deployed live on Admin yet (purely env-toggle once a Letta docker container is running anywhere reachable from the Next.js app).
>
> **Autoresearch loop ran end to end.** `scripts/run-autoresearch-demo.ts` (calls the `autoresearch<T>()` runtime from `src/lib/hermes/autoresearch.ts`) executed three cycles against live Codex 5.5 on Admin via the subprocess path. Each cycle: subprocess invocation → real Codex reply → score the reply → keep or revert by the loop. Sample run produced three valid 7-word sentences ("AI agents transform goals into autonomous actions.", "AI agents make complex goals act independently", "AI agents convert intent into reliable progress.") all scoring 1.000 by the word-count metric. Loop converged on cycle 1, the other two were kept in history (tie = revert).
>
> ## Sprint VPS state (2026-05-22)
>
> Five VPS running Hermes v0.14.0 (Admin + blair-prod + ccm-josh-prod + ccm-justin-prod + marti). Admin is fully wired runtime side (Codex 5.5 OAuth via Chris's ChatGPT, Composio MCP with seven tools, Google Calendar smoke test passed end-to-end). Blair Codex OAuth done. Marti Hermes installed; Telegram bot for Admin runs against Marti's bot token as a test rig until clients send their own. Remaining client deliverables (Composio `ck_` + Telegram tokens + OAuth windows) tracked in the sprint registry.
>
> ## What is left for Rami on dashboard
>
> Branded skin per client (Marti / Blair / CCM), Composio API integration for live numbers, the "Hire New Agent" section, and the chat surface refactor in `src/components/agents/AgentChatTab.tsx` to consume Hermes events from the bridge (the NDJSON event shape is unchanged, but the producer is now `chatReplyViaHermes` instead of `chatReplyViaSdk`). The autoresearch loop module is wired in but no UI surface yet; expose as a `/admin/autoresearch` panel where operators can kick off a goal-driven optimisation run against a profile.
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

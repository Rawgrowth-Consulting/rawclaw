# Architecture - v4 (Hermes Agent migration)

This branch is the migration target: swap the home-grown rawclaw v3 agent runtime for **NousResearch Hermes Agent** as the central orchestration engine, cherry-pick our valuable IP on top.

## What v4 changes vs v3

| Layer | v3 | v4 |
|---|---|---|
| Agent runtime | rawclaw `chatReply()` + `agent-commands.ts` + drain server | Hermes Agent (HTTP gateway, Python, MIT, self-hosted) |
| LLM provider | Claude Max OAuth via `claude` CLI | OpenAI Codex 5.5 via device-code OAuth (client's own ChatGPT subscription) |
| Tools | per-tool MCP wrappers in `src/lib/mcp/tools/*` | Composio MCP server (250+ tools, single integration) |
| Memory | local pgvector + Honcho | Hermes SQLite local + per-server (no shared Supabase memory; faster, simpler) |
| Telegram | custom webhook bridge in `src/app/api/webhooks/agent-telegram` | Hermes gateway built-in (systemd service) |
| Dashboard | Next.js 16 app (v3, kept) | Next.js 16 app (refactored to call Hermes HTTP gateway + Composio APIs directly; no longer talks to local chatReply) |
| DB | local Postgres + remote Supabase mirror | remote Supabase only (Hermes SQLite is ephemeral local cache) |

## Top-level deploy shape per client

```
client.rawgrowth.ai  →  Vercel (dashboard, branded per client)
                                |
                                ├─→  Composio APIs (read tool data for the dashboard)
                                └─→  Hermes HTTP gateway @ https://agent.client.rawgrowth.ai
                                        (or :8642 internal on the VPS)
                                              |
                                              ├─→  Codex 5.5 inference (client's ChatGPT OAuth)
                                              ├─→  Composio MCP server (tool execution)
                                              └─→  Telegram gateway (systemd, on the same VPS)
```

One Hetzner VPS per client. Dashboard is hosted on Vercel and points back at the VPS's HTTP gateway for live agent ops + the "Hire New Agent" flow. All data (conversations, agent state, memory) lives on the VPS in `~/.hermes/`.

## What we keep from v3 (KEEP)

- `src/components/agents/AgentChatTab.tsx` chat UI - reconfigure the SSE/NDJSON consumer to talk to Hermes instead of rawclaw chatReply
- Org / agents / routines / connections dashboard pages (frontend stays, swap the backend call)
- Auth, RBAC, dept-ACL (`src/lib/auth/dept-acl.ts`) - gates which Hermes profile a logged-in user can chat with
- DB schema for org, users, agents roster, audit (`rgaios_*` tables) - identity + tenancy intact
- Composio per-user OAuth catalog + Composio routes (`src/app/api/connections/composio/*`)
- Brand voice + 11 banned words (`src/lib/brand/*`, `eslint.config.mjs`) - lives as MCP tools on Hermes
- Per-agent + company RAG (`src/lib/knowledge/*`) - exposed as MCP tools
- Telegram streaming editor UX (`src/lib/telegram/client.ts` createStreamingEditor) - the Hermes gateway already streams; we just translate its SSE shape

## What v4 replaces (DROP)

- `src/lib/agent/chat.ts` chatReply runtime
- `src/lib/agent/chat-sdk.ts`, `sdk-runner.ts`, `agent-commands.ts` (LATE_DELEGATIONS, verifyDelegatedOutput, depth gate, postback Map) - Hermes spawn does this natively
- `/opt/rawclaw-drain/drain-server.mjs` + `rgaios_routine_runs` claim/complete cycle - Hermes `/v1/jobs` replaces it
- Most generic CRUD MCP tools in `src/lib/mcp/tools/*` (routines, runs, approvals, supabase, slack, agents, agent-messaging) - Hermes built-ins cover these

## VPS setup (current state, 2026-05-22)

Five servers running this branch in production-ready state:

| VPS | IP | Codex OAuth | Composio MCP | Telegram bot | Dashboard |
|---|---|---|---|---|---|
| Admin | 5.161.51.44 | done (Chris) | done (`ck_s9dv...`, 7 tools, Google Calendar connected) | pending | n/a |
| blair-prod | 5.161.118.223 | done (Blair Plus $20) | pending | pending | pending |
| ccm-josh-prod | 49.13.131.164 | pending | pending | pending | pending |
| ccm-justin-prod | 78.47.48.118 | pending | pending | pending | pending |
| marti (existing IP) | 49.13.116.154 | pending | pending | done (systemd, `@marti_marketing_bot`) | pending |

## Notes for whoever picks this up

- Hermes v0.14.0 only polls the OpenAI device-code endpoint for 10 minutes even though OpenAI considers codes valid for 15. Coordinate the OAuth window before sending the code.
- Hermes config.yaml does NOT expand `${MCP_*}` env var references inside the `mcp_servers` block - inline the `ck_` literal directly in `headers`.
- `hermes mcp add --auth header` defaults to `Authorization: Bearer`, but Composio MCP rejects `ck_` keys via Bearer - patch the YAML header name to `x-consumer-api-key` after the add command.
- The Codex provider rejects `gpt-5.1-codex` with HTTP 400 ("not supported when using Codex with a ChatGPT account"). Working model names against ChatGPT-account Codex: `gpt-5.5` (recommended), `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex`.
- Marti's old rawclaw v3 Supabase `rgaios_*` schema is dumped and stored locally if you need to rehydrate the 7 existing agent system prompts (Scan, Ania, Kasia, Zosia, Basia, Marta, Engineering Manager) instead of rebuilding from scratch. AES-256-GCM, key = SHA256("rawgrowth:secret-at-rest:v1:" + `JWT_SECRET`).

# Rawgrowth AIOS

**An AI operating system for companies.** Delivered as a SaaS platform — each client gets a unique subdomain where their team connects tools, deploys agents, and queries their company LLM. No install required; log in, connect, and go.

Rawgrowth is built on two tightly-coupled pieces of tech:

1. **Company LLM** — a per-tenant knowledge layer that makes all of a business's data queryable, from inside and outside the app.
2. **Agent Organization** — custom AI agents arranged in an org chart, running repeatable workflows (routines) on triggers.

The LLM is the read side. The agents are the write side. Integrations feed both.

---

## 1 — Company LLM

A private, always-up-to-date brain for each client's business.

### What it is

Every integration a client connects pipes its data into a **per-tenant vector store** with strict isolation by `company_id`. At query time a base model (Claude, GPT, Gemini) answers grounded in the chunks retrieved from the client's data.

This is RAG — not a fine-tuned model. Two consequences worth naming:

- It updates instantly as the source data changes.
- It costs orders of magnitude less than training a bespoke model per client, while behaving like one in practice.

### What integrations contribute

| Tool | Data it contributes |
| --- | --- |
| Shopify / Stripe | orders, customers, revenue, subscriptions |
| HubSpot | pipeline, deals, contacts, conversation history |
| Google Drive / Notion | SOPs, playbooks, internal documents |
| Gmail / Slack | conversation history |
| Fathom | meeting transcripts and summaries |
| Google Analytics / Meta | traffic, ad spend, attribution |
| Mailchimp | campaign performance, audience segments |

### Access surfaces

The Company LLM isn't locked to the Rawgrowth app. It exposes itself through multiple surfaces so the client's team can use it from wherever they already work:

- **In-app agents** — custom agents hired inside Rawgrowth query the LLM as part of their reasoning loop.
- **Remote MCP server** — each company gets its own MCP endpoint URL. Paste it into Claude Desktop, Cursor, or any MCP-compatible client, and that tool now has the company's full data graph.
- **Connection strings** — shorter programmatic access for custom scripts and integrations.
- **Telegram / chat bots** — a thin bot wrapper talks to the same MCP server so team members can ask questions from their phone.

### Why this is the core piece

Everything downstream — agents, routines, automations — is only as useful as the context the LLM has. The LLM is the moat: the longer a client runs on Rawgrowth, the richer and more differentiated their LLM becomes.

---

## 2 — Agent Organization

A customer's AI workforce: a hierarchy of custom AI agents, each with a role, a manager, a budget, and a job description.

### Agents

Clients hire agents inside the app the same way they'd hire humans:

- **Name + title** — e.g. Atlas, *Head of Growth*
- **Role** — CEO / CTO / Engineer / Marketer / SDR / Ops Manager / Designer / General
- **Reports-to** — a manager in the org chart (or none, if they're a root)
- **Job description** — plain-English responsibilities
- **Runtime** — which model powers them (Claude Sonnet/Opus/Haiku, GPT, Gemini)
- **Monthly budget** — hard spend cap; agent stops when hit

Agents are visualised as an org chart with connector lines. Clicking any card opens an edit sheet with pause, resume, and fire actions. Every agent runs against the Company LLM by default — so they know the business.

### Routines — automated workflows

Agents don't sit idle. Each agent can own one or more **routines** — repeatable workflows that fire on triggers.

A routine is simply:

> **trigger** + **assigned agent** + **natural-language instructions**

The agent decides *how* to execute using the integrations and tools it has access to. No node graph, no step-by-step DAG — the LLM is the planner.

### Trigger types

- **Schedule** — cron expression or preset (every hour, every weekday at 9, every Monday, custom).
- **Webhook** — Rawgrowth mints a unique inbound URL per trigger; any service can POST JSON to fire the routine.
- **Integration event** — fires when a connected tool emits an event (e.g. *Fathom — Meeting ended*, *Stripe — Payment succeeded*, *Shopify — New order*, *HubSpot — Deal stage changed*). Events from unconnected integrations are greyed out in the UI with a "Connect" CTA.
- **Manual** — explicit "Run now" only; useful for ad-hoc execution.

Multiple triggers per routine are supported. Any trigger firing runs the routine.

### A concrete routine

**Post-call SOP generator**

- **Trigger**: Fathom — *Meeting ended*
- **Agent**: Atlas, Head of Client Success
- **Instructions**:
  1. Pull the transcript from the webhook payload.
  2. Look up the client in Google Drive and pull any existing SOP notes.
  3. Write a tailored SOP draft for them.
  4. Email it to the client's account manager.

When the meeting ends in Fathom → webhook fires → routine invokes Atlas → Atlas pulls context from the Company LLM (Drive + CRM + past emails already indexed) → drafts an SOP → sends it via Gmail.

---

## How the two pillars interlock

```
                 ┌──────────────────────────┐
                 │      Integrations        │
                 │  (Shopify, HubSpot,      │
                 │   Stripe, GDrive, Gmail, │
                 │   Fathom, Slack, Notion) │
                 └─────────┬───────────┬────┘
                           │           │
                  feeds    │           │   events / webhooks
                  data     ▼           ▼   fire triggers
           ┌─────────────────────┐ ┌──────────────────────┐
           │   Company LLM       │ │  Routines            │
           │   (per-tenant RAG   │ │  (trigger + agent +  │
           │    + MCP server)    │ │   instructions)      │
           └─────────┬───────────┘ └──────────┬───────────┘
                     │                        │
                     │ queried by             │ assigns work to
                     ▼                        ▼
           ┌─────────────────────────────────────────────┐
           │              Agent Organization             │
           │    (hired agents in an org chart, each      │
           │     with a role, manager, budget, runtime)  │
           └──────────────────────┬──────────────────────┘
                                  │
                                  │ takes actions via
                                  ▼
                            Integrations
```

Integrations serve both pillars: they supply the data that becomes the LLM, and they supply the events that fire routines and the tools agents use to act.

---

## Integration auth model

Two auth methods cover everything the product needs to connect:

- **API Key** — user pastes a secret from the provider's dashboard; Rawgrowth encrypts and stores it, sends it as an auth header on every outbound call. Simple, works with any service. Used by: Shopify, Stripe, Fathom, Mailchimp.
- **OAuth 2.0** — user clicks Connect, gets redirected to the provider's login, grants scoped permissions; Rawgrowth receives access + refresh tokens and stores them encrypted. Auto-refreshing, user-revocable. Used by: Google Analytics, Meta, HubSpot, Slack, Notion, Google Drive, Gmail.

A third flow worth naming — **webhook inbound** — is orthogonal to auth: providers that send events to us get a unique generated URL + signing secret per connection. Stripe, Shopify, Fathom, and HubSpot all support this alongside their primary auth method.

---

## Current build state

**Stack**: Next.js 16 App Router · Tailwind v4 · shadcn/ui on Base UI · visx for charts · Zustand for local state · dark-only emerald theme matching [rawgrowth.ai](https://rawgrowth.ai).

**Shipped**:

- Dashboard with four business-pillar charts (Marketing line, Sales funnel, Fulfilment stacked bar, Finance area)
- Integrations catalog (11 services) with per-integration connection sheet supporting API Key / OAuth / Webhook methods
- Agents page unified with Org Chart — tree layout, click-to-edit sheet, hire/fire/pause flows, persistence
- Routines builder with four trigger kinds; integration-event triggers gated by connection status
- Shared design primitives (PageShell, EmptyState, sidebar, user popover)

**Next**:

- Persistence moves from `localStorage` to Neon Postgres via Drizzle, schema modelled after Paperclip's `agents`, `routines`, `routine_triggers`, `routine_runs` tables
- OAuth callback + inbound webhook route handlers
- Real agent runtime via Claude Agent SDK (the production replacement for Paperclip's local `claude` CLI adapter)
- Per-tenant vector store (pgvector in Neon) + MCP server exposing each company's data graph
- Durable workflow execution via Vercel Workflow for routine runs
- Cost metering per agent per company via Vercel AI Gateway

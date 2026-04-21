# Rawclaw — Architecture (v3)

One-line: **Per-client VPS runs everything. No Mac Mini required. Client only touches the dashboard + their phone.**

---

## The model

Every client gets one dedicated VPS at `<slug>.rawgrowth.ai`. That VPS runs:

- The Rawclaw **dashboard** (Next.js) — agents, routines, channels, skills, approvals
- A **Postgres** + **PostgREST** database for the client's org
- An **MCP endpoint** at `/api/mcp` that Claude Code connects to
- A **Telegram webhook** that receives inbound bot messages
- The **Claude Code CLI itself**, authed with the client's Claude Max account
- A **systemd** layer for scheduled work

Client hardware needed: **none**. They use the dashboard in a browser and the Telegram bot on their phone.

```
  Phone ──────── Telegram ─────────┐
  Browser ────── HTTPS ────────────┤
                                    │
                                    ▼
                          VPS (wylie.rawgrowth.ai)
                          ┌─────────────────────────────┐
                          │ Next.js dashboard           │
                          │ Postgres + PostgREST        │
                          │ Caddy (TLS)                 │
                          │ MCP server                  │
                          │ Telegram webhook            │
                          │ Claude Code CLI (headless)  │
                          │ systemd timers              │
                          └─────────────────────────────┘
```

---

## Why no Mac Mini

Claude Code is a Node.js CLI. It runs on Linux. Anthropic ships a headless mode + SDK for exactly this use case. A Linux VPS is, by definition, a 24/7 always-on machine — it doesn't need to be "kept open."

The integrations (Gmail, Slack, Notion, GitHub, Drive) are tied to the **Claude account**, not the device. Authenticate once on any machine logged into the client's account, and they work everywhere that account is used.

**The Mac Mini is optional — it becomes a premium on-prem tier offering, not a required component.**

### Three-tier product ladder

| Tier | Runtime | Use case |
|---|---|---|
| **Standard** | VPS only | Most clients — fastest onboarding, lowest unit cost |
| **On-Prem** | VPS (dashboard) + Mac Mini at client's office (Claude Code runtime) | Data-sensitive / compliance-heavy clients |
| **Enterprise** (future) | Client's own cloud or air-gapped | Massive orgs with existing infra |

---

## The Telegram event-driven flow

Replies arrive in 5–10 seconds. No polling. No Mini.

```
1. Phone sends message to @<slug>_bot
2. Telegram POSTs to VPS: /api/webhooks/telegram/[connectionId]
3. Webhook:
     a. Stores the message in rgaios_telegram_messages
     b. Spawns `claude --print "drain telegram inbox"` as a background subprocess
     c. Returns HTTP 200 to Telegram immediately (<100ms)
4. Claude Code (headless, on the VPS):
     - Calls telegram_inbox_read MCP tool — sees the new message
     - Decides what to do (use Gmail, Slack, agent memory, etc.)
     - Calls telegram_reply MCP tool — pushes response back through Telegram
5. Phone receives the reply ~5–10 seconds after sending
```

This is event-driven. No cron polling lag. Each inbound message wakes Claude Code on-demand.

Per-invocation cost: ~a few cents of Claude usage. For Max-plan clients, usage counts against their personal window.

---

## Scheduled routines

For routines that fire on a schedule (daily digest at 9am, hourly recruiting triage, etc.):

- A **systemd timer** runs `claude --print "/rawgrowth-triage"` on cron
- Claude Code claims the next pending `rgaios_routine_runs` row, executes it, marks complete
- Same MCP tools + connectors as the Telegram flow

One systemd unit handles all scheduled work. Polling interval for pending routines is 1–2 minutes.

---

## The agent model

Agents are **DB records + personas**. Fields:

- `name`, `title`, `role`, `description`
- `reports_to` (org chart hierarchy)
- `department` (marketing / sales / fulfilment / finance)
- `integrations` (Gmail, Slack, Notion, …)
- `skills` (reference ids from the static skill catalog)

They're not separate AI models or background workers. When Claude Code is told "act as Theo", it:

1. Calls `agents_list` via MCP → sees Theo's persona + skills + connectors
2. Loads the relevant skill content from `~/.claude/skills/` (auto-installed via `/rawgrowth-skills-sync`)
3. Adopts Theo's role and executes with the right context

One Claude model under the hood, steered different ways per agent.

---

## Skills

A **112-item catalog** (109 from `scanbott/claude-skills` + 3 originals) lives in `src/lib/skills/catalog.ts`. Rebranded as RawClaw skills, categorized (engineering / marketing / sales / ops / design / ui / finance), searchable in `/skills`.

Skill assignment is per-org (table: `rgaios_agent_skills`). Assignment is metadata — the actual skill content loads via `npx skills add <url> --skill <name>` on whatever machine runs Claude Code. The `/rawgrowth-skills-sync` slash command auto-installs missing skills on first-run.

---

## Data model — key tables

```
rgaios_organizations    (name, slug, mcp_token, pillar flags)
rgaios_users            (email, name, password_hash, org_id, role)
rgaios_invites          (token_hash, email, role, expires_at)
rgaios_agents           (name, title, role, description, department, reports_to, write_policy)
rgaios_agent_skills     (agent_id ↔ skill_id)
rgaios_routines         (title, description, assignee_agent_id, status)
rgaios_routine_triggers (kind: manual | schedule, cron, timezone)
rgaios_routine_runs     (status: pending | running | succeeded | failed)
rgaios_approvals        (status: pending | approved | rejected, context)
rgaios_connections      (provider_config_key, metadata, nango_connection_id)
rgaios_telegram_messages (chat_id, sender, text, received_at, responded_at)
rgaios_audit_log        (kind, actor, detail, organization_id, created_at)
rgaios_password_resets  (token_hash, user_id, expires_at)
```

Enforced invariant: **one organization per VPS** (DB trigger on `rgaios_organizations`).

---

## Roles

- `owner` — full control, can remove members, transfer ownership
- `admin` — can invite + configure, can't remove owners
- `member` — standard access
- `developer` — seeded on every VPS, held by Rawgrowth for support access

Owner can remove any role except the last owner. Every VPS has Rawgrowth's `developer` user pre-seeded so the team can SSH in and provide support.

---

## Onboarding flow

1. Operator exports `GITHUB_TOKEN` + `RESEND_API_KEY` (one-time, in `~/.zshrc`)
2. Run: `./scripts/provision-vps.sh --host <ip> --domain <slug>.rawgrowth.ai --email <admin> --org "<Name>"`
   - Installs Docker, clones `rawclaw` repo via SSH deploy key
   - Writes `.env`
   - Boots the stack (Postgres + PostgREST + Next.js + Caddy)
   - Runs migrations, seeds the org, prints invite URL + MCP token
3. Client clicks invite URL → sets password → on the dashboard
4. Operator runs the **Claude Code installer** on the target runtime (VPS for Standard, Mini for On-Prem):
   ```
   curl -fsSL https://raw.githubusercontent.com/Rawgrowth-Consulting/rawclaw-installer/main/cc-install.sh \
     | bash -s -- --token <rgmcp_...> --url https://<slug>.rawgrowth.ai
   ```
5. Operator authorizes connectors (Gmail, Slack, Notion, GitHub) once in Claude Code
6. systemd timer for scheduled routines + Telegram webhook event spawning = live automation

Time to live: ~30 minutes per client.

---

## Deployment

- **Source repo**: `github.com/Rawgrowth-Consulting/rawclaw` (private, SSH deploy-key per VPS)
- **Public installer**: `github.com/Rawgrowth-Consulting/rawclaw-installer` (cc-install.sh only)
- **Code updates**: `ssh root@<vps>` + `git pull && docker compose up -d --build app`
- **Per-client code changes**: none. Same codebase for every client. Variation is data (agents, routines, skills).

---

## Security model

- Postgres bound to `127.0.0.1:5432` inside the VPS (never public). pgAdmin connects via SSH tunnel.
- All external traffic via Caddy with Let's Encrypt certs.
- MCP endpoint auth via per-org bearer token (`rgmcp_...`).
- NextAuth with JWT sessions for dashboard auth; Resend for invite + reset emails from `portal@rawgrowth.ai`.
- Rawgrowth `developer` user on every client VPS for support access (clearly audit-logged).
- Single-org DB trigger prevents accidental cross-tenant corruption.

---

## What's NOT yet built (honest backlog)

- **Claude Code installation on VPS** — planned for the "instant Telegram" build (~1 hour)
- **Event-driven Telegram webhook** — spawns `claude --print` on inbound messages
- **systemd timer for scheduled routines** — once Claude Code is on VPS
- **Rate limiting / queueing** for concurrent Telegram messages (current: naive one-process-per-message)
- **Anthropic API fallback** — long-term ToS safety if Max becomes unviable for commercial automation
- **Fleet update dashboard** — roll updates across all client VPSes in one action
- **On-Prem Mini runner setup doc** — premium tier installer for Mac Mini at client office

---

## What's NOT Rawclaw's job

- **Client's bespoke apps** — e.g. Wylie's sales-floor dashboard, CRM, dialer. Those are separate Next.js apps on the client's own Vercel/GitHub, built by the client's agents. Rawclaw is the org-chart + agent-orchestration layer, not a CRM platform.
- **OAuth token storage for integrations** — these live inside Anthropic (per Claude account). Rawclaw just knows which connectors each agent uses.
- **Executing AI work** — Claude Code does that. Rawclaw stores state and coordinates.

---

## One-paragraph pitch

Rawclaw is a self-hosted OS for your AI employees. Every client gets a VPS at `<their-slug>.rawgrowth.ai` with a dashboard to manage agents, routines, skills, and channels. Their Claude Max subscription runs headless on the same VPS, triggered by Telegram messages (5–10 second replies) or scheduled routines. Integrations (Gmail, Slack, Notion) are authorized once in Claude and inherited by every agent. No hardware required, no laptop to keep open. The Mac Mini is available as a premium on-prem tier for data-sensitive clients.

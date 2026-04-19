# VPS Subscription v2 — Self-hosted + Local Claude Code

> **Goal:** Let technical clients run the rawgrowth workspace on a VPS we provision for them, and drive it from their own Claude Code (or Claude Desktop) instance using their Claude Max subscription — so no Anthropic API bill.
>
> **The v1 product (hosted SaaS on API) stays.** This is a second SKU for a different buyer.

---

## 1. The mental model

There are **three** machines in this architecture. Keep them straight:

| Machine | What runs there | Who owns it |
| --- | --- | --- |
| **Client's laptop** | Claude Code / Claude Desktop | Client |
| **Per-client VPS** | Dockerized rawgrowth instance (Next.js + Postgres + Caddy) | Rawgrowth (we deploy it, client rents it via subscription) |
| **Rawgrowth control plane** | Provisioning scripts, update pipeline, billing | Rawgrowth |

**What the client "installs" locally is NOT the codebase.** It's a Claude Code plugin (two slash commands + a starter pack) that teaches their local Claude how to reach the VPS via MCP. The "install" is a few KB of config, not the app itself.

---

## 2. What stays vs what changes

### Stays (no changes for self-hosted mode)
- Next.js app structure, App Router, all pages, components
- MCP server at [/api/mcp](src/app/api/mcp/route.ts) — **this is the primary interface in v2**
- All MCP tool handlers ([src/lib/mcp/tools/](src/lib/mcp/tools/))
- Nango integration layer (provider config keys, connection handling)
- Supabase schema (runs on self-hosted Postgres instead)
- Agents, routines, approvals, knowledge, members — all the same DB tables

### Goes away in self-hosted mode
- The autonomous executor loop ([src/lib/runs/executor.ts](src/lib/runs/executor.ts)). No `generateText()` calls. The "agent" IS local Claude Code.
- Vercel cron for scheduled triggers (clients schedule prompts through their own IDE or macOS automation if they want)
- The `ANTHROPIC_API_KEY` env requirement
- Anything that calls `@ai-sdk/anthropic` server-side

### New surface area
- Dockerfile + docker-compose.yml
- Self-hosted Postgres + migration auto-runner
- Claude Code plugin package (`rawgrowth-plugin`) with 2 slash commands
- Provisioning script (creates VPS, DNS, secrets, MCP token)
- Update script (tag → pull → restart across all client VPSs)
- Mode flag (`DEPLOY_MODE=self_hosted` vs `hosted`) to conditionally disable executor

---

## 3. Phased build plan

### Phase 1 — Dockerize the app (1–2 days)

Goal: produce a single `docker-compose.yml` that stands up a complete rawgrowth instance.

**Tasks:**
1. Write `Dockerfile` — multi-stage build, Node 24 LTS, `next build`, standalone output.
2. Add `docker-compose.yml` with:
   - `app` (our Next.js image, port 3000)
   - `postgres` (supabase/postgres or postgres:16-alpine)
   - `caddy` (auto TLS via Let's Encrypt, reverse-proxy to `app`)
3. Swap Supabase Cloud for self-hosted Postgres:
   - `supabaseAdmin()` already takes a URL + key — point it at the local Postgres container
   - Generate a JWT secret on first boot; bake a `service_role` JWT that matches
   - Drop any Supabase-specific features we don't use (we use almost none — just the JS client API)
4. Migration runner: entrypoint script that runs `supabase/migrations/*.sql` in order on boot. Make every migration idempotent (`create table if not exists`, `alter ... add column if not exists`, etc.) — most already are.
5. Env var contract: document everything the compose file needs (`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `RESEND_API_KEY`, `NANGO_SECRET_KEY`, `EMAIL_FROM`, etc.).

**Acceptance:** `docker compose up` on a clean machine produces a working instance reachable at `http://localhost:3000` with a seeded admin user.

### Phase 2 — Remove the API dependency (half day)

Goal: the self-hosted instance should not need `ANTHROPIC_API_KEY` to boot or run.

**Tasks:**
1. Add `DEPLOY_MODE` env (`hosted` | `self_hosted`, default `hosted`).
2. In `self_hosted` mode:
   - Skip mounting the executor on cron triggers
   - Routines become "prompts" — the routine's instructions are exposed as an MCP prompt (via `prompts/list` and `prompts/get`) that local Claude Code can invoke
   - Scheduled triggers write to a `routine_runs` row but don't execute — the UI just shows "queued for local Claude"
3. Hide "runtime" (model) picker on agent sheet when `DEPLOY_MODE=self_hosted` — it's meaningless
4. Write a small adapter: when a run is "executed" via the MCP `prompts/get` call, mark the row as `running` then `succeeded` based on whether Claude acknowledged it

**Acceptance:** `docker compose up` with no `ANTHROPIC_API_KEY` set works fine; no errors; MCP endpoint serves tools + prompts.

### Phase 3 — Claude Code plugin (half day)

Goal: client runs 2 slash commands and is fully connected.

**Packaging:** publish as an npm-installable Claude Code plugin, OR distribute as a ZIP with an `install.sh` that drops files into `~/.claude/`. Simpler: use the Claude Code plugin marketplace/manifest format.

**The commands:**

#### `/rawgrowth-connect <token>`
Writes an MCP server config to the user's Claude Code settings pointing at their VPS:

```json
{
  "mcpServers": {
    "rawgrowth": {
      "url": "https://{subdomain}.rawgrowth.app/api/mcp",
      "headers": { "Authorization": "Bearer rgmcp_..." }
    }
  }
}
```

Token format is what you already mint in [0003_mcp_tokens.sql](supabase/migrations/0003_mcp_tokens.sql). The slash command parses `{subdomain}` from the token prefix or a second arg.

#### `/rawgrowth-setup <role>`
Downloads a starter pack and drops it into `.claude/` inside the current project:
- `CLAUDE.md` primer ("You are the operator of a Rawgrowth AI company. The workspace has agents X, Y, Z…")
- A few preset slash commands (`/daily-triage`, `/draft-newsletter`) that expand to useful prompts
- Pulls the agent + routine list from the VPS via MCP so the primer is always current

The `<role>` switch loads different starter packs (`founder`, `ops`, `marketing`, etc.).

**Acceptance:** fresh laptop with Claude Code installed + Max subscription + two slash commands = fully operational.

### Phase 4 — Provisioning automation (1 day)

Goal: onboarding a client takes one command, not a checklist.

**Build a `scripts/provision-client.ts`:**
1. Calls Hetzner/DigitalOcean API to create a droplet (2GB RAM is plenty for one client)
2. SSHes in, installs Docker + Docker Compose
3. `git clone` the rawgrowth repo at a pinned tag OR `docker pull` a prebuilt image from a registry
4. Writes `.env` with per-client secrets (unique NEXTAUTH_SECRET, unique Postgres passwords, fresh MCP token)
5. Creates DNS A record `{slug}.rawgrowth.app` → droplet IP (Cloudflare API)
6. Runs `docker compose up -d`
7. Seeds the admin user row so the client can log into the UI
8. Prints the `/rawgrowth-connect <token>` command to give the client

**Acceptance:** `node scripts/provision-client.ts --name "Acme Corp" --email sarah@acme.com` takes ~90 seconds and produces a running instance.

### Phase 5 — Update pipeline (half day)

Goal: ship a new feature → all client VPSs get it the same day.

**Approach:** GitHub Actions on `main` branch merge:
1. Build Docker image, tag as `:latest` + commit SHA, push to GHCR (GitHub Container Registry)
2. `scripts/update-all-clients.ts` iterates over `clients.json` (your master list) and for each:
   - SSH in
   - `docker compose pull && docker compose up -d`
   - Health check (`curl /api/health` returns 200)
   - Rollback to previous tag on failure

Long-term: swap for a proper orchestration (Nomad, Kamal, Dokku) once you have >10 clients. Don't over-engineer at 3.

**Acceptance:** push to main, all clients running new version within 5 minutes, zero manual steps.

### Phase 6 — Client onboarding flow (half day)

Ship the operational runbook:
1. Sales call → get client to install Claude Code + have Max subscription ready
2. We run `provision-client.ts` → 90 seconds later, their instance exists
3. Email them: link to their subdomain, starter docs, the 2 slash commands to paste
4. 30-min setup call where we help them connect integrations (Nango flow works identically on self-hosted)
5. They're off.

---

## 4. Pricing model (what we sell)

| SKU | Who it's for | What we charge | What they pay externally |
| --- | --- | --- | --- |
| **Managed** (v1 — current) | Non-technical teams, "do it for us" | $10k+/mo includes API | Nothing — we eat API |
| **Self-hosted** (v2 — this doc) | Technical teams, want cost control, already have Claude Max | $2–3k/mo platform fee + one-time $2k setup | Claude Max ($100–200/mo/seat), VPS ($10–20/mo) |

Notes:
- Managed margin shrinks as usage climbs. Self-hosted margin is flat. Self-hosted scales better above ~$15k/mo/client equivalent API cost.
- Both SKUs share 95% of the codebase. The split is a deployment mode and a few conditionals, not a rewrite.

---

## 5. Risks and open questions

1. **Nango:** each VPS needs a Nango workspace. Either (a) share one hosted Nango account with per-client `end_user.id` scoping (what we already do — easy), or (b) self-host Nango in the compose stack (harder, more isolation). Start with (a).
2. **Supabase Storage:** we use it for knowledge files. Self-hosted Postgres doesn't ship with it. Either switch to local filesystem storage (simplest, ephemeral — bad if VPS rebuilds), or S3/R2 with per-client bucket. Decide in Phase 1.
3. **Auth:** NextAuth JWT works fine self-hosted. Just make sure `NEXTAUTH_URL` and `NEXTAUTH_SECRET` are baked per-instance.
4. **Backups:** Postgres backups must be automatic. Add a nightly `pg_dump` → S3 or managed-Postgres-as-a-service per client. Non-negotiable before signing paid clients.
5. **Security:** each VPS runs on public internet with TLS. Audit log, rate-limit the MCP endpoint, make sure service role Postgres isn't exposed.
6. **The "2 slash commands are enough" claim** needs to be validated with a real client. Plan for a 3rd: `/rawgrowth-status` to show run health, pending approvals, etc. from inside Claude Code.
7. **Scheduled routines in self-hosted mode** — without our executor, "run every Monday at 9am" doesn't work natively. Option: ship a tiny cron helper in the plugin that fires a slash command on schedule (via Claude Code's own scheduling features or a system cron wrapper). Decide in Phase 2.

---

## 6. Order of operations (next 2 weeks)

1. **Week 1:**
   - Phase 1 (Dockerize, self-hosted Postgres)
   - Phase 2 (strip executor behind mode flag)
   - Spin up a test VPS, onboard yourself as client zero
2. **Week 2:**
   - Phase 3 (Claude Code plugin + 2 slash commands)
   - Phase 4 (provisioning script)
   - Onboard the first real client against the v2 flow, write up what broke
3. **Buffer week:**
   - Phase 5 (update pipeline) before client #2
   - Phase 6 (onboarding runbook) before client #3

**Do not** build the update pipeline before you have a second client. Solve the problem you have, not the problem you might have.

---

## 7. What we are NOT building (for now)

- Multi-node / HA per client (one VPS each, full stop)
- In-app billing for self-hosted (invoice manually)
- A custom plugin marketplace
- Anything that requires Anthropic API keys on the client side
- Automatic Claude Code installation — we assume they have it

# Running Rawgrowth Self-Hosted (Phase 1)

This is the v2 SKU — per-client VPS, no Anthropic API billing, driven from
local Claude Code via MCP. See [VPS_SUBSCRIPTION_V2.md](VPS_SUBSCRIPTION_V2.md)
for the full strategy.

Phase 1 only packages the existing app so it stands up in Docker with its
own bundled Postgres + PostgREST. Executor teardown (Phase 2) and the
Claude Code plugin (Phase 3) are separate steps.

## What you need

- Docker Desktop (or Docker Engine + Compose v2)
- `openssl` (ships on every Mac and Linux)
- ~2GB free RAM

**You do NOT need Node installed** — the container handles all of that.

## One command

From a fresh checkout:

```bash
./scripts/bootstrap.sh
```

(or `npm run self-hosted:bootstrap` if you have Node, same script.)

It will:

1. Verify Docker is running
2. Copy `.env.self-hosted.example` → `.env` (skipped if you already have one)
3. Generate `POSTGRES_PASSWORD`, `JWT_SECRET`, `NEXTAUTH_SECRET` if they're still placeholders
4. `docker compose up --build -d`
5. Tail the app logs so you see the credentials banner

The container mints its own service-role JWT from `JWT_SECRET` on boot —
no manual step.

You'll see a banner like:

```
[seed] First-boot bootstrap complete
  Organization:  Local Dev (local-dev)
  Admin email:   admin@local
  Admin password (generated — save this!):
    aB12cD34eF56...
  MCP token (paste into Claude Code config):
    rgmcp_a1b2c3...

  Sign in:       http://localhost/auth/signin
```

Save both — the password is shown once, the MCP token can be re-fetched
from the DB if you lose it (see CLAUDE_CODE_SETUP.md).

Open `.env` and confirm if you want to customise:

- `CADDY_SITE_ADDRESS` = `localhost` for local dev, or your subdomain in prod
- `NEXTAUTH_URL` = `http://localhost` for local dev, or `https://<subdomain>` in prod
- `SEED_ADMIN_EMAIL` if you want something other than `admin@local`

Once up:

- App:       http://localhost
- Health:    http://localhost/api/health
- Postgres:  connection via `docker compose exec postgres psql ...`

## First-boot seed

The container auto-seeds an org + admin user + MCP token on first boot
when the database is empty, using these env vars:

```
SEED_ADMIN_EMAIL=you@example.com
SEED_ADMIN_PASSWORD=at-least-8-chars
SEED_ORG_NAME=Local Dev    # optional
SEED_ORG_SLUG=local-dev    # optional
SEED_ADMIN_NAME=You        # optional
```

After `npm run self-hosted:up`, watch the logs:

```bash
npm run self-hosted:logs
```

You'll see a banner like:

```
[seed] First-boot bootstrap complete
  MCP token: rgmcp_...
```

Copy that token — you'll paste it into Claude Code (see
[CLAUDE_CODE_SETUP.md](CLAUDE_CODE_SETUP.md)).

You can now sign in at http://localhost/auth/signin with the email +
password from your `.env`.

The seed is **idempotent** — subsequent boots skip it as soon as any
organization exists in the DB.

## Useful commands

```bash
npm run self-hosted:up      # (re)build + start all services
npm run self-hosted:down    # stop everything
npm run self-hosted:logs    # tail the app logs
npm run self-hosted:migrate # run migrations against DATABASE_URL (host-side)
```

## How integrations work in self-hosted mode

**Rawclaw does NOT OAuth into Gmail/Slack/etc. for you.** In self-hosted,
the client's Claude Code is what drives every routine, and Claude Code
already has native connectors for Gmail, Google Calendar, Google Drive,
Slack, Notion, Linear, GitHub, Asana, Canva, and more. The client
authorizes those once in Claude Desktop/Code settings and they're
available to every routine.

For tools Anthropic doesn't ship natively (Shopify, Stripe, custom APIs)
the client installs a community MCP server in their Claude Code config.

The `/integrations` page in the UI is a **reference + guide** in
self-hosted mode — no OAuth bounce, no "connected" pill, nothing to
configure.

## What's deferred (Phase 1.5+)

- **Executor / autonomous runs** — intentionally off in self-hosted;
  the client's Claude Code is the executor. Runs stay `pending` until
  Claude picks them up via `runs_claim`.
- **Knowledge file uploads** — pulled from self-hosted entirely. Clients
  drag local markdown into Claude Code's context window directly.

## Verifying it's healthy

```bash
curl http://localhost/api/health
# → {"ok":true,"deployMode":"self_hosted","db":"ok","uptimeSec":N,"took":N}
```

If `deployMode` says `self_hosted` and `db` says `ok`, you're good.

## Next phases

- **Phase 2:** strip the executor in self-hosted mode and expose routines as MCP prompts
- **Phase 3:** build the `/rawgrowth-connect` + `/rawgrowth-setup` Claude Code plugin
- **Phase 4:** automate VPS provisioning with a single script
- **Phase 5:** push-button updates across all client instances

# Running Rawgrowth Self-Hosted (Phase 1)

This is the v2 SKU — per-client VPS, no Anthropic API billing, driven from
local Claude Code via MCP. See [VPS_SUBSCRIPTION_V2.md](VPS_SUBSCRIPTION_V2.md)
for the full strategy.

Phase 1 only packages the existing app so it stands up in Docker with its
own bundled Postgres + PostgREST. Executor teardown (Phase 2) and the
Claude Code plugin (Phase 3) are separate steps.

## What you need

- Docker Desktop (or Docker Engine + Compose v2)
- Node 20+ on your host for generating the JWT (one-off)
- ~2GB free RAM

## One-time setup

```bash
# 1. Copy and fill in the env
cp .env.self-hosted.example .env

# 2. Generate strong secrets
openssl rand -hex 32   # paste into POSTGRES_PASSWORD
openssl rand -hex 32   # paste into JWT_SECRET
openssl rand -hex 32   # paste into NEXTAUTH_SECRET

# 3. Mint the service_role JWT for PostgREST using the JWT_SECRET above
npm run self-hosted:jwt -- --secret "<your JWT_SECRET>"
#  → copy the output into SUPABASE_SERVICE_ROLE_KEY in .env
```

Open `.env` and confirm:

- `CADDY_SITE_ADDRESS` = `localhost` for local dev, or your subdomain in prod
- `NEXTAUTH_URL` = `http://localhost` for local dev, or `https://<subdomain>` in prod

## Run it

```bash
npm run self-hosted:up
```

First boot takes a minute (building the Next.js image, running migrations).
Subsequent boots are ~15 seconds.

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

## What doesn't work yet

- **Executor / routines / scheduled runs** — agents can't run autonomously
  in self-hosted mode. Phase 2 removes the executor entirely; for now
  creating a "run" will just sit at `pending`. This is expected.
- **Knowledge file uploads** — Supabase Storage isn't bundled. Uploads
  will fail. Phase 1.5 will switch to local filesystem or S3.
- **Nango connections** — still work, but share one hosted Nango account
  across all client VPSs (scoped by `end_user.id` = org id).

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

# Marti VPS - Set ANTHROPIC_API_KEY fallback

P12 ops doc per [B 03:57 → C]. Unblocks v20+ walks when
OAuth quota is hit before the 5h window resets.

## Purpose

Marti runs in Claude-Max-first mode (Path A) via
`src/lib/llm/oauth-first.ts`. When every connected OAuth
token has hit its 5h-window quota, `oauth-first.ts:171-176`
falls back to **Path B**: direct Anthropic API key billing
via `process.env.ANTHROPIC_API_KEY`. Without that env var
set, the fallback is a no-op and the agent halts with a
"Hit our run limit" message.

Setting `ANTHROPIC_API_KEY` on the Marti VPS unblocks the
flagship walk immediately even when OAuth quota is locked.

## Pre-requisites

- SSH access to `marti.rawgrowth.ai` (`ssh root@marti.rawgrowth.ai`)
- Anthropic API key from <https://console.anthropic.com>
  (separate billing account from the OAuth tokens already
  connected via `/connections`, ideally - otherwise both
  paths drain the same wallet)

## Steps

```bash
# 1. SSH to the VPS.
ssh root@marti.rawgrowth.ai

# 2. Move to the app root.
cd /opt/rawclaw

# 3. Edit the env file.
nano .env

# 4. Add (or replace) the line:
#    ANTHROPIC_API_KEY=sk-ant-api03-...
#
#    Save + exit (Ctrl-O, Enter, Ctrl-X in nano).

# 5. Recreate the container so the new env is picked up.
docker compose -f docker-compose.v3.yml up -d --force-recreate

# 6. Confirm the container is running on the new env.
docker compose -f docker-compose.v3.yml ps
docker compose -f docker-compose.v3.yml logs --tail=20 | grep -i anthropic
```

## Verify Path B is live

Trigger any agent reply on Marti. In `docker compose logs`
look for:

```
[oauth-first] all OAuth tokens exhausted, falling back to ANTHROPIC_API_KEY
```

That log line confirms the path switched. The operator-facing
chat reply should NOT show the "Hit our run limit" message;
instead the agent should answer normally.

## Costs

Direct API billing is per-token at standard Anthropic pricing
(see <https://www.anthropic.com/pricing>). Path B traffic
shows up on the Anthropic console under the key's account,
NOT on the Claude Max OAuth account.

For Marti's typical R-MARTI-CANONICAL walk (~20k input
tokens + 3k output for a delegated apify scrape reply), the
incremental cost is on the order of a few cents per walk at
Sonnet 4.6 rates. Expect single-digit USD per night of
intensive testing.

## Rollback / disable Path B

```bash
ssh root@marti.rawgrowth.ai
cd /opt/rawclaw
# Either comment out the line or unset:
sed -i 's/^ANTHROPIC_API_KEY=/# ANTHROPIC_API_KEY=/' .env
docker compose -f docker-compose.v3.yml up -d --force-recreate
```

Container restart reads the updated env; Path B becomes
inactive and the agent reverts to Claude-Max-only behavior.

## Why not check this into the repo

`ANTHROPIC_API_KEY` is a secret with billing access. It MUST
stay in `/opt/rawclaw/.env` on the VPS only; never commit it
to git, never pass it to CI workflows, never echo it in WB
entries. The `.env` file at the repo root is git-ignored;
the prod `.env` on the VPS is the single source of truth.

## Related files

- `src/lib/llm/oauth-first.ts:171-176` - the fallback path
- `src/lib/llm/provider.ts` - per-provider router
- `scripts/provision-vps.sh` - VPS bootstrap (does NOT set
  the key; that step is manual on first install)

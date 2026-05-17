# Production runbook - Rawclaw v3 / Marti

Operator-facing runbook for the v3 deploy on Marti VPS. Designed
for the first 5 minutes of an incident - quick reference + the
three live failure modes we've actually hit + monitoring + deploy.

Last updated: 2026-05-17 (P18 per B 04:25 -> C).

## Quick reference

| Thing | Value |
|---|---|
| Marti URL | `https://marti.rawgrowth.ai` |
| v3 head | `git log --oneline origin/v3 -1` |
| VPS access | `ssh marti.rawgrowth.ai` |
| App root on VPS | `/opt/rawclaw` |
| Compose file | `/opt/rawclaw/docker-compose.v3.yml` |
| DB | Supabase Cloud (project `rawclawv3`) |
| Drain server port | `9876` (host-side, started by `provision-vps.sh`) |
| Cron tick | `rawclaw-tick.timer` (systemd) |
| Health endpoint | `curl -sI https://marti.rawgrowth.ai/api/healthz` |
| Pedro admin login | `pedro@admin.com` / `WalkTest2026!` |
| Service logs | `docker logs --tail 200 rawclaw-app` |

## Incidents

### Marti returns 502

Symptom: `curl -sI https://marti.rawgrowth.ai` returns
`HTTP/2 502` or Caddy reverse-proxy error page.

```
1. Confirm:
   curl -sI https://marti.rawgrowth.ai

2. Pull logs:
   ssh marti.rawgrowth.ai
   docker logs --tail 100 rawclaw-app

3. If container is restarting (you see repeated startup
   lines): wait 90 seconds. Next.js cold-start can take that
   long on CX22.

4. If logs show a persistent crash loop with the same stack
   on each restart:
   git log origin/v3 -3
   Identify the most recent commit that touches the crashing
   path. If it landed in the last hour and the trace points
   at it, revert:
     git revert <sha>
     git push origin v3

5. Re-deploy on Marti:
   ssh marti.rawgrowth.ai
   cd /opt/rawclaw
   git pull origin v3
   docker compose -f docker-compose.v3.yml up -d --build

6. Verify:
   curl -sI https://marti.rawgrowth.ai
   Expected: HTTP/2 200 (or 307 redirect to /portal).
```

### Claude Max quota - 429 / "Hit our brief pause"

Symptom: agent chat hangs or shows "Hit our brief pause"; logs
contain `rate_limit_error` from the Anthropic OAuth path.

```
1. Confirm quota source:
   ssh marti.rawgrowth.ai
   docker logs rawclaw-app 2>&1 | grep -E 'rate_limit|oauth-first'

2. Three options, in escalation order:

   Option A - wait it out:
     Claude Max quota is a 5h rolling window. If we are within
     ~30min of the window edge, just wait. Confirm the edge by
     finding the oldest request in the log within the last 5h.

   Option B - flip to ANTHROPIC_API_KEY (Path B fallback):
     See docs/PROVISIONING_ANTHROPIC_API_KEY.md for the full
     runbook. TL;DR:
       ssh marti.rawgrowth.ai
       cd /opt/rawclaw
       nano .env   # add ANTHROPIC_API_KEY=sk-ant-api03-...
       docker compose -f docker-compose.v3.yml up -d --force-recreate
     Confirmation log line:
       [oauth-first] all OAuth tokens exhausted, falling back
       to ANTHROPIC_API_KEY

   Option C - add another Claude Max OAuth account:
     Sign into /connections on Marti as admin, click "Connect
     Claude Code", authorize a second Claude Max seat. Round-
     robin lives in src/lib/llm/oauth-first.ts.

3. Re-test:
   Send a one-shot prompt to Scan from the chat UI; confirm
   reply lands within 15s.
```

### Migration rollback

Symptom: a migration applied to Supabase Cloud broke production
(e.g. 0075-class IMMUTABLE disaster, or a `DROP COLUMN` that
removed data still needed by deployed code).

```
1. NEVER manual DROP / DELETE / TRUNCATE without a backup
   handle. Stop and breathe.

2. Forward-fix is almost always safer than rollback. Cut a new
   migration that re-creates the dropped object / restores
   defaults / patches the broken function. Push as 0079_..._fix
   (or whatever the next number is). The pipeline will replay
   on Marti via npm run self-hosted:migrate.

3. If forward-fix is not possible and the migration was applied
   in the last 24h, restore from Supabase point-in-time recovery:
     - Supabase dashboard -> Database -> Backups
     - "Restore to a point in time" -> pick a timestamp 5
       minutes before the bad migration
     - Restore creates a new project; promote it manually or
       copy the affected tables back to the live project.

4. If data was lost: open the incident, ping Chris, document
   what was lost + what the recovery window was. Do NOT silently
   re-apply.
```

## Monitoring

```
# Daemon + Marti uptime + WB size + /tmp pressure (P13 script)
bash scripts/check-daemons.sh
# Exit code = number of failed checks.

# Generate a Markdown summary of merged + open + walks +
# daemon delegation + dispatch counters
bash scripts/wb-curate.sh > /tmp/summary.md

# Walk regression (Tier 2 mocked - does not need quota)
npm run test:e2e

# Unit suite incl. 80+ jargon assertions
npm run test:unit
```

For the CI gate inventory, see the jobs in
`.github/workflows/ci.yml`: `lint`, `test`, `build`,
`migrations`. The `jargon-gate` job (PR #22 once merged) and
`migration-safety` job (PR #33 once merged) extend the wall.

## Deploy

Standard path:

```
1. Merge PR to v3 branch on GitHub.

2. CI must be green:
   gh run list --limit 3
   gh run watch                       # block until current run done

3. ssh marti.rawgrowth.ai
   cd /opt/rawclaw
   git pull origin v3
   docker compose -f docker-compose.v3.yml up -d --build

4. Smoke:
   curl -sI https://marti.rawgrowth.ai/api/healthz
   Sign in as pedro@admin.com, fire one canonical walk on
   Scan, confirm reply contains no banned tokens.

5. Tail logs for 60s post-deploy:
   docker logs -f --tail 50 rawclaw-app
```

Hot-deploy without rebuild (config-only changes like .env):

```
ssh marti.rawgrowth.ai
cd /opt/rawclaw
docker compose -f docker-compose.v3.yml up -d --force-recreate
```

## Architecture overview

The humanize gateway is the single biggest moving piece for
operator-visible behavior. Read
[docs/ARCHITECTURE_HUMANIZE_GATEWAY.md](./ARCHITECTURE_HUMANIZE_GATEWAY.md)
before touching anything in `src/lib/agent/jargon.ts` or any of
the five render-boundary surfaces.

Other architecture docs:

- `README.md` - top-level repo orientation + overnight delivery
  notes.
- `ARCHITECTURE-V3.md` - system diagram, migration table,
  request-flow traces.
- `DEPLOY-V3.md` - fresh-droplet deployment runbook (this doc
  covers incidents; that one covers cold-start).
- `docs/PROVISIONING_ANTHROPIC_API_KEY.md` - Path B fallback.
- `docs/MORNING_SUMMARY_2026-05-17.md` - overnight PR queue
  + suggested merge order.
- `docs/MIGRATION_REVIEW_NOTES_2026-05-17.md` - per-PR
  rollback + risk + dependency notes for the migration
  batch.

## Contacts

| Role | Name |
|---|---|
| CEO / final say | Chris West |
| AI COO / scope | Scan |
| Eng infra patterns | Ali |
| Client-facing copy | Dilan |
| Owner | Pedro Afonso |

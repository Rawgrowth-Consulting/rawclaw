# Provisioning a Client VPS

For YOU (the operator) — the steps to deploy rawgrowth onto a client's
VPS in ~5 minutes. Run all of this from **your own** laptop.

**The client never runs `git clone`. The client never installs Node or
Docker. The client does not open the rawgrowth codebase.** They only run
the one-line `cc-install.sh` to configure Claude Code.

All the heavy lifting happens on the VPS (where `provision-vps.sh`
`git clone`s the code) and on your laptop (where you run the provision
script). From the client's perspective they get a URL, a password, and a
Claude Code command to paste.

## What you need before the visit

1. **A VPS for the client.** Hetzner CX22 ($4/mo), DO Basic Droplet ($6/mo),
   or any Ubuntu 22.04+ / Debian 12+ box with:
   - 2GB RAM minimum (4GB recommended)
   - SSH access (root or sudo)
   - Public IP, ports 22/80/443 open
2. **A subdomain** like `acme.rawgrowth.app` with an A record pointing at
   the VPS IP. **Set this BEFORE running provision** so Caddy can issue
   TLS certs on first boot.
3. **Your laptop** with this repo cloned locally.

Optional but recommended (set as env vars before running provision so
they get baked into the client's `.env`):

```
export RESEND_API_KEY=re_...
export EMAIL_FROM='Rawgrowth <noreply@rawgrowth.app>'
export NANGO_SECRET_KEY=...
export NANGO_PUBLIC_KEY=...
export NANGO_WEBHOOK_SECRET=...
```

## Provision (one command)

```bash
./scripts/provision-vps.sh \
  --host 1.2.3.4 \
  --domain acme.rawgrowth.app \
  --email founder@acme.com \
  --org "Acme Corp" \
  --ssh-user root
```

What happens (~3 min total):

1. Installs Docker on the VPS if missing
2. `git clone`s the rawgrowth repo to `/opt/rawgrowth`
3. Generates `.env` with strong secrets, the client's domain, the seed admin
4. `docker compose up --build -d`
5. Waits for the credentials banner and prints it for you

The output ends with the `MCP token` and admin credentials. **Copy both.**

## Hand-off to the client

On the client's laptop, they run (or you run for them):

```bash
curl -fsSL https://raw.githubusercontent.com/JamesWeb3/rawgrowth-aios/main/scripts/cc-install.sh \
  | bash -s -- --token rgmcp_PASTED_FROM_ABOVE --url https://acme.rawgrowth.app
```

This installs the rawgrowth MCP server config and the slash commands into
their Claude Code. They restart Claude Code, type `/mcp`, confirm, and
type `/rawgrowth-status` for the first end-to-end check.

## Updating a client later

```bash
./scripts/update-vps.sh --host 1.2.3.4
```

Pulls main, rebuilds the image, runs migrations on boot, hits `/api/health`
to verify. Repeat for each client until you outgrow this and need a real
fleet manager (Phase 5).

## Adding a new client list entry

For now, keep a tiny `clients.txt` outside this repo:

```
acme.rawgrowth.app  1.2.3.4  root
beta.rawgrowth.app  5.6.7.8  ubuntu
```

Then for any "ship update to all clients":

```bash
while read -r domain host user; do
  ./scripts/update-vps.sh --host "$host" --ssh-user "$user"
done < clients.txt
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Caddy fails to get a cert | DNS A record isn't propagated yet — wait 60s and `docker compose restart caddy` |
| `/api/health` returns 503 | Postgres or PostgREST didn't come up — `docker compose logs postgres postgrest` |
| Seed banner never appeared | An org already exists in the DB (seed is idempotent). Look up the MCP token: `docker compose exec postgres psql -U postgres -d rawgrowth -c "select mcp_token from rgaios_organizations;"` |
| Client can't sign in | Check the password in the seed banner output; if it scrolled away, rotate via `docker compose exec postgres psql ...` and `update rgaios_users set password_hash = '...' where email = '...'` |

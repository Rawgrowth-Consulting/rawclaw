# Rawclaw — Client Onboarding Runbook

Standard path: ~30 minutes per client, live on a call.

---

## Prerequisites (operator's laptop, one-time)

```bash
export GITHUB_TOKEN=github_pat_...        # for deploy-key registration
export RESEND_API_KEY=re_...              # for invite emails
```

Add both to `~/.zshrc` so every future terminal has them.

---

## 1. DNS (30 sec)

At your DNS provider for `rawgrowth.ai`, add an A record:
- **Name:** `<client-slug>` (e.g. `wylie`)
- **Value:** Hetzner VPS IP
- **Proxy:** OFF (DNS-only if Cloudflare)

Verify: `dig @1.1.1.1 <slug>.rawgrowth.ai +short` → returns the IP.

## 2. Provision the VPS (~5 min)

Create the VPS in Hetzner (CX32 recommended — 8GB RAM), then:

```bash
./scripts/provision-vps.sh \
  --host <ip> \
  --domain <slug>.rawgrowth.ai \
  --email <client-email> \
  --org "<Client Name>" \
  --ssh-user root
```

Script installs Docker, clones the repo, writes `.env`, boots the stack, runs migrations, seeds the org. Prints invite URL + MCP token at the end — save both.

Add swap on the VPS:
```bash
ssh root@<ip> '
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
'
```

## 3. Client accepts the invite (1 min — client does this)

Send them the invite URL printed from step 2. They click it, set a password, they're signed in to `https://<slug>.rawgrowth.ai`.

## 4. Authenticate Claude Code with client's Max subscription (~2 min — live on call)

**This is the only step that genuinely requires the client on the call.**
Node.js, Claude Code CLI, the `rawclaw` user, the MCP registration, and the
drain server are all already set up by `provision-vps.sh` in step 2.

On your laptop:
```bash
ssh -t root@<ip> 'sudo -iu rawclaw claude login'
```

The VPS prints a URL.

- Share the URL with the client via Zoom chat / Slack / email
- Client opens it in their laptop's browser
- Client signs in with **their** Claude Max Anthropic account
- Anthropic shows a one-time authorization code
- Client pastes the code back to you
- You paste it into the SSH session waiting for it
- Claude Code on the VPS is now running against **their** Max subscription

Smoke test:
```bash
ssh root@<ip> "sudo -iu rawclaw claude --print '/rawgrowth-status'"
```

Returns the org's pulse = Max + MCP both wired.

## 5. Install slash commands for the client (~30 sec)

The MCP is already registered by `provision-vps.sh`. This step installs the
slash commands (`/rawgrowth-chat`, `/rawgrowth-status`, `/rawgrowth-help`, etc)
into `/home/rawclaw/.claude/commands/`:

```bash
ssh root@<ip> "sudo -iu rawclaw bash -c '
  curl -fsSL https://raw.githubusercontent.com/Rawgrowth-Consulting/rawclaw-installer/main/cc-install.sh \
    | bash -s -- --token $(grep ^MCP_BEARER_TOKEN /opt/rawgrowth/.env | cut -d= -f2) --url https://<slug>.rawgrowth.ai
'"
```

## 6. Authorize native Claude connectors (~5 min — client-led)

Client opens https://claude.ai/settings/connectors in their browser and authorizes each tool they want their agents to use:
- Gmail
- Google Calendar / Drive
- Slack
- Notion
- Linear
- GitHub

These authorizations live in their Anthropic account → inherited by Claude Code on the VPS automatically (same account, same tokens).

## 7. Install skills the client's agents need (~1 min)

Back in the SSH session on the VPS:
```bash
ssh root@<ip> "sudo -iu rawclaw claude --print '/rawgrowth-skills-sync'"
```

Scans agent assignments, installs any missing skills via `npx skills add`.

## 8. Connect Telegram (~2 min — client does the BotFather half, you do the dashboard half)

1. Client opens Telegram on their phone, chats with **@BotFather**
2. `/newbot` → gives it a name and a username ending in `bot`
3. BotFather returns a token
4. Client sends you the token (or enters it themselves if they're signed in)
5. Go to `https://<slug>.rawgrowth.ai/channels` → Telegram card → **Connect** → paste token
6. Webhook auto-registers; card flips to "Connected"

Event-driven auto-reply is already wired: inbound free-text messages hit the
webhook, which pings `rawclaw-drain.service` on the host, which spawns Claude
Code and replies in 5–10s. No polling, no cron.

---

## Handoff to client

Email them:
```
Dashboard:  https://<slug>.rawgrowth.ai
Telegram:   @<slug>_rawclaw_bot
Support:    Rawgrowth has a 'developer' account pre-seeded on your
            instance for support. You can remove it any time via
            Company → Members → Remove.
```

Total onboarding time: ~30 minutes with the client on a call.

---

## Notes

- Step 5 (Claude Code auth) is the only step that genuinely requires the client on the call. Everything else can be done by the operator alone.
- Every VPS has the operator's `developer` role pre-seeded so you can SSH in + support them without needing re-invitation.
- If the VPS needs a code update: `ssh root@<ip> 'cd /opt/rawgrowth && git pull && docker compose up -d --build app'`.

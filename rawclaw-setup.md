# Client Onboarding Runbook

For the in-person/Zoom session where you set up Rawgrowth at a client.
Time budget: **30 minutes**.

**What the client installs on their laptop: nothing.**
They already have Claude Code + Claude Max. Your one-line installer adds
the MCP server config and three slash commands. That's it — no git, no
Docker, no codebase cloning.

**What the client uses day-to-day:**
- Their existing Claude Code (or Claude Desktop) on their laptop
- The Rawgrowth web UI at their subdomain (for dashboards, approvals, integrations)

That's the whole surface. Everything else lives on the VPS you provisioned.

---

## Before the call (you, ~10 min the day before)

- [ ] Confirm client has Claude Code installed and a Claude Max subscription active
- [ ] Spin up a VPS for them (Hetzner CX22 ~$4/mo or DO basic ~$6/mo). Note the IP.
- [ ] Add a DNS A record `<their-slug>.rawgrowth.app` → VPS IP. Wait for it to propagate (~5 min).
- [ ] Run `./scripts/provision-vps.sh` per [PROVISIONING.md](PROVISIONING.md). Save the printed banner — you need the **MCP token** and **admin password**.
- [ ] Smoke test: `curl https://<their-slug>.rawgrowth.app/api/health` returns `{"ok":true}`.

You arrive (or jump on Zoom) with everything pre-deployed. The client just needs to connect.

---

## Live with the client (~25 min)

### 1. Sign them into the web UI (5 min)

- [ ] Open `https://<their-slug>.rawgrowth.app/auth/signin`
- [ ] Hand them the admin email + password (or paste in chat)
- [ ] First sign-in works → take 2 min to walk them through the sidebar
  (Dashboard, Agents, Routines, Approvals, Activity, Integrations, Members)
- [ ] Encourage them to update the password under Members → their profile (TODO if not built)

### 2. Connect their first integration (5 min)

- [ ] Go to `/integrations`
- [ ] Click their priority integration (Gmail in 9/10 cases)
- [ ] Walk them through the Nango OAuth bounce
- [ ] Confirm the green "Connected" pill appears
- [ ] Show them where to come back to disconnect/reconnect

### 3. Connect Claude Code (5 min)

On their laptop, run:

```bash
curl -fsSL https://raw.githubusercontent.com/JamesWeb3/rawgrowth-aios/main/scripts/cc-install.sh \
  | bash -s -- --token <MCP_TOKEN> --url https://<their-slug>.rawgrowth.app
```

- [ ] Restart Claude Code
- [ ] Type `/mcp` — confirm `rawgrowth` is listed
- [ ] Type `/rawgrowth-help` — Claude lists the available tools and prompts

### 4. Author one real routine together (5 min)

Pick something the client actually does. Common starters:

- "Triage my Gmail inbox each morning, draft replies for anything urgent"
- "Summarize new Slack messages from #leads each afternoon"
- "Draft a weekly LinkedIn post in my voice from my recent wins"

In the UI:
- [ ] Routines → New routine
- [ ] Title + plain-English description (the description IS the prompt — be specific)
- [ ] Status: Active
- [ ] Save

### 5. Drive the routine end-to-end with Claude Code (5 min)

In their Claude Code:

```
/rawgrowth-status
```

(Claude shows them what's pending — should show their new routine has 0 runs but exists as a prompt.)

Then click **Run now** in the UI for the routine. A pending run appears.

```
/rawgrowth-triage
```

Claude picks it up, executes it using their Gmail integration, and marks
it complete. Refresh the Activity tab — they see the run go from
`pending` → `succeeded` with Claude's summary attached.

**This is the magic moment.** Stop and let them feel it.

### 6. Approvals (briefly, 2 min)

- [ ] Open the agent they care about → set Gmail policy to "Requires approval"
- [ ] Trigger the routine again → run goes to pending, Approvals inbox lights up
- [ ] Show them the amber pill in the sidebar
- [ ] Approve from the inbox → the email actually drafts

### 7. Wrap (3 min)

- [ ] Show them how to add another routine (one paragraph in the description, that's it)
- [ ] Show them where to invite teammates: `/company/members`
- [ ] Tell them: any tweaks they want, just text you — you'll push updates to their VPS, they don't need to do anything

---

## After the call (you, ~5 min)

- [ ] Add their VPS to your `clients.txt` for future bulk updates
- [ ] Save their MCP token + admin creds in 1Password (or wherever)
- [ ] Send a follow-up email with:
  - Their sign-in URL
  - The cc-install one-liner (in case they need to set up another laptop)
  - "Reply to this email any time you want a tweak — usually within 24h"
- [ ] Diary a 7-day check-in

---

## What to push back on (politely)

- **"Can it run by itself overnight?"** — Not in self-hosted mode. The
  whole point is your Claude Max subscription drives it. Schedule prompts
  in macOS Reminders or use a cron one-liner if they want a ping.
- **"Can I install plugins/scripts to extend it?"** — Not yet. Tell them
  what they want, you'll add it server-side and push.
- **"Can my whole team use it?"** — Yes — invite teammates from
  `/company/members`. Each teammate connects their own Claude Code with
  the same MCP token (or you can mint per-user tokens later).

---

## Failure modes during the live setup

| Issue | Recovery |
| --- | --- |
| Caddy hasn't gotten a cert yet | Use http:// for the demo, fix DNS after |
| MCP server doesn't connect | Have them run `/mcp` — read the error. Usually a token typo or stale Claude Code |
| Gmail OAuth fails | Check Nango is configured for their domain; if not, fall back to demo mode |
| Routine sits pending forever | Their Claude Code isn't watching — explain they have to drive it with `/rawgrowth-triage` |

# Hermes deployment playbook

This is the exact recipe used to bring four client VPS to a Hermes-ready state in the May 2026 sprint. Copy-paste safe for new servers.

## Prerequisites on the laptop

- `hcloud` CLI authenticated against the Rawgrowth Hetzner project
- SSH keys `Rawgrowth2026` + `pedroafonso@Pedro` uploaded to Hetzner
- Local SSH agent has `~/.ssh/id_ed25519` (matches one of the keys)

## Step 1: provision the VPS

```bash
~/.local/bin/hcloud server create \
  --name <name>-prod \
  --type cpx21 \
  --image ubuntu-22.04 \
  --location ash \
  --ssh-key Rawgrowth2026 \
  --ssh-key pedroafonso@Pedro \
  --start-after-create
```

For EU clients use `--type cpx22 --location fsn1` instead (cpx22 is the equivalent type available there).

## Step 2: reset the root password (optional but documented)

```bash
~/.local/bin/hcloud server reset-password <name>-prod
```

Capture the password to the server-connections doc.

## Step 3: SSH in and run the install script

```bash
ssh root@<ip> 'bash -s' <<'REMOTE'
set -e
cd /

# Python 3.11 is required by Hermes. Ubuntu 24.04 ships without it in default repos.
apt-get update -qq
apt-get install -y -qq software-properties-common
add-apt-repository -y ppa:deadsnakes/ppa
apt-get update -qq
apt-get install -y -qq curl git python3.11 python3.11-venv python3.11-dev \
  nodejs npm ripgrep ffmpeg build-essential tmux

# Hermes itself
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh -o /tmp/h.sh
bash /tmp/h.sh --skip-browser

# Provider + model
python3 - <<PY
import yaml
p = "/root/.hermes/config.yaml"
c = yaml.safe_load(open(p))
c["model"]["provider"] = "openai-codex"
c["model"]["default"] = "gpt-5.5"
yaml.safe_dump(c, open(p, "w"), sort_keys=False)
PY

hermes status
REMOTE
```

## Step 4: client-live Codex OAuth

The client must have an active paid ChatGPT subscription (Plus $20 minimum). Coordinate a window where they have ~10 minutes available and ChatGPT open in their browser.

```bash
ssh root@<ip>
tmux kill-session -t codex 2>/dev/null || true
tmux new-session -d -s codex 'script -q -c "hermes auth add openai-codex --no-browser" /tmp/codex.log'
sleep 8
tmux capture-pane -t codex -p
```

Capture URL + user code from the pane output. Send to the client immediately:

```
Open this URL in the browser where ChatGPT is logged in:
https://auth.openai.com/codex/device

Paste this code:
<USER-CODE>

Then click Authorize. Code expires in about 8 minutes on our side.
```

Hermes polls for 10 minutes (not the full 15 the code is technically valid for). If the client misses the window, kill the tmux session, restart, regenerate.

When the client clicks Authorize, Hermes auto-saves `/root/.hermes/auth.json`. Backup to laptop:

```bash
scp root@<ip>:/root/.hermes/auth.json ~/Downloads/<name>-auth.json
scp root@<ip>:/root/.hermes/.env ~/Downloads/<name>-env
chmod 600 ~/Downloads/<name>-{auth.json,env}
```

## Step 5: Composio MCP

The client signs up at composio.dev, connects their tools, and sends the Composio account login.

```bash
ssh root@<ip>
hermes mcp add composio --url https://connect.composio.dev/mcp --auth header
# When prompted for the API key, paste the ck_ value from dashboard.composio.dev
```

Hermes saves the key to `~/.hermes/.env` as `MCP_COMPOSIO_API_KEY=ck_...` and writes the server entry to `~/.hermes/config.yaml`. Two manual patches are required:

```bash
# 1. The env var substitution doesn't expand in config.yaml. Inline the literal:
python3 - <<PY
import yaml
p = "/root/.hermes/config.yaml"
c = yaml.safe_load(open(p))
c["mcp_servers"]["composio"]["headers"] = {"x-consumer-api-key": "ck_..."}
c["mcp_servers"]["composio"]["enabled"] = True
yaml.safe_dump(c, open(p, "w"), sort_keys=False)
PY

# 2. Verify
hermes mcp test composio
```

The test command should report `Connected` and list 7 tools (COMPOSIO_MULTI_EXECUTE_TOOL, COMPOSIO_SEARCH_TOOLS, COMPOSIO_MANAGE_CONNECTIONS, etc.).

## Step 6: Telegram bot

The client creates a bot via @BotFather and sends the bot @username + token. (For Marti, the token was extracted from her existing rawclaw v3 Supabase rather than recreated.)

```bash
ssh root@<ip>
sed -i 's|^# TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=<TOKEN>|' /root/.hermes/.env
echo "GATEWAY_ALLOW_ALL_USERS=true" >> /root/.hermes/.env
yes y | hermes gateway install --system --run-as-user root
hermes gateway status
```

The gateway runs as a systemd service (`hermes-gateway.service`) and auto-starts on boot. Restrict access by Telegram user ID later via `TELEGRAM_ALLOWED_USERS` if needed; for the initial setup `GATEWAY_ALLOW_ALL_USERS=true` is fine.

## Step 7: E2E smoke test

```bash
hermes chat -q "Reply with exactly: HELLO WORLD" -Q
```

If Composio tools are wired, also test a real tool call:

```bash
hermes chat -q "Use COMPOSIO_SEARCH_TOOLS to list available Gmail tools. One line per tool." -Q
```

## Step 8: backup credentials to laptop

After every successful OAuth or wire step, scp `/root/.hermes/auth.json` and `/root/.hermes/.env` to the laptop credentials folder. Restore is the same files in reverse if the VPS dies.

## Known issues

- **Codex model name**: `gpt-5.1-codex` returns HTTP 400 against ChatGPT-account Codex. Use `gpt-5.5` (recommended), `gpt-5.4`, `gpt-5.4-mini`, or `gpt-5.3-codex`.
- **OAuth polling timeout**: Hermes polls 10 min, OpenAI codes valid 15 min. Coordinate the window.
- **Composio Bearer rejection**: MCP endpoint accepts only `x-consumer-api-key` header for `ck_` keys, not `Authorization: Bearer`.
- **Env var substitution**: `${MCP_*}` references in `mcp_servers` block do not expand. Inline literals.
- **fail2ban on Marti**: aggressive default config could ban your IP after a few SSH retries. If you get locked out, `hcloud server enable-rescue` + chroot + `fail2ban-client unban --all`. The Hetzner web console also works.

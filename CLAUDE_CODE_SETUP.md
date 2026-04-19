# Connecting Claude Code to your self-hosted Rawgrowth

This is the manual version of what the Phase 3 plugin will eventually
automate. It takes ~60 seconds.

## You'll need

- Claude Code installed locally (`npm install -g @anthropic-ai/claude-code` or via Cursor/VSCode)
- A Claude Max subscription signed in
- A running Rawgrowth instance (see [SELF_HOSTED.md](SELF_HOSTED.md))
- Your **MCP token** — printed once on first boot in the docker logs, e.g.:

  ```
  ──────────────────────────────────────────────────────────
  [seed] First-boot bootstrap complete
  ──────────────────────────────────────────────────────────
    Organization:  Local Dev (local-dev)
    Admin email:   you@example.com
    Admin role:    owner

    MCP token (paste into Claude Code config):
      rgmcp_a1b2c3d4...
  ──────────────────────────────────────────────────────────
  ```

  Lost it? Look it up in the DB:
  ```bash
  docker compose exec postgres \
    psql -U postgres -d rawgrowth -c \
    "select name, mcp_token from rgaios_organizations;"
  ```

## Add the MCP server to Claude Code

Open `~/.claude/settings.json` (create it if missing) and add:

```json
{
  "mcpServers": {
    "rawgrowth": {
      "url": "http://localhost/api/mcp",
      "headers": {
        "Authorization": "Bearer rgmcp_PASTE_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

For a remote VPS, swap `http://localhost` for `https://your-subdomain.rawgrowth.app`.

Restart Claude Code (or reload settings — `/mcp` in Claude Code lists active servers).

## Confirm the connection

In Claude Code, run:

```
/mcp
```

You should see `rawgrowth` listed with these capabilities:

- **Tools** — `gmail_search`, `gmail_get_message`, `gmail_draft`,
  `list_knowledge_files`, `read_knowledge_file`, `runs_list_pending`,
  `runs_claim`, `runs_complete`, `runs_fail`
- **Prompts** — one per active routine in your org

## Drive a routine end-to-end

1. In the Rawgrowth UI (http://localhost), create a routine — e.g.
   "Daily Gmail triage" with description: *"Find any unread emails from
   today, summarize each, draft replies for the urgent ones."*
2. Trigger it from the UI ("Run now") — a `pending` run is created.
3. In Claude Code, ask:

   ```
   List my pending Rawgrowth runs and execute the oldest one.
   ```

   Claude will:
   - Call `runs_list_pending` → sees the queued run
   - Call `runs_claim` with the run id → gets the routine instructions
   - Call `gmail_search`, `gmail_draft`, etc. as needed
   - Call `runs_complete` with a summary when done
4. Refresh the Activity tab in the UI — the run shows `succeeded` with
   Claude's summary as output.

## What's different from hosted mode

- **No autonomous runs.** Scheduled triggers still create `pending` runs,
  but nothing executes them automatically. You drive each one through
  Claude Code.
- **No API costs.** Every model call happens in your Claude Code session
  on your Max subscription quota.
- **No `/runtime` model picker on agents** — meaningless when the agent
  is local Claude.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `/mcp` doesn't show rawgrowth | Restart Claude Code; check JSON is valid; check token starts with `rgmcp_` |
| MCP server says "Unauthorized" | Token is wrong or org's `mcp_token` was rotated |
| Tools error "Not connected" | Connect the integration in the UI at /integrations |
| Tools work but Claude can't see prompts | The routine isn't `active` — toggle it in the UI |
| `runs_claim` says "isn't pending" | Already claimed by another worker — call `runs_list_pending` again |

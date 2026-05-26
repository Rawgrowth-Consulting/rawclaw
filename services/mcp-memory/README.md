# mcp-memory

Stdio MCP server exposing the 4-tier memory chain (Hermes SQLite + Honcho + mem0 + Letta) as tools the Hermes agent itself can call inside its reasoning loop.

This is the inverse of `src/lib/memory/index.ts`: that file is the Next.js side that writes / reads memory from the dashboard surface; this server is the Hermes side, so the agent can issue `tool:memory_write({...})` and `tool:memory_read({...})` from inside its own reasoning loop and get persistent context across turns.

## Install

```bash
cd services/mcp-memory
pip install -r requirements.txt
```

## Wire into Hermes

```bash
hermes mcp add memory \
  --command python3 \
  --args /opt/rawclaw/services/mcp-memory/server.py
```

Then patch `~/.hermes/config.yaml` to set env vars on the mcp_servers entry:

```yaml
mcp_servers:
  memory:
    command: python3
    args: ["/opt/rawclaw/services/mcp-memory/server.py"]
    enabled: true
    env:
      MEMORY_TIERS: "hermes,honcho,mem0,letta"
      HONCHO_BASE_URL: "http://localhost:8001"
      MEM0_BASE_URL: "http://localhost:8765"
      LETTA_BASE_URL: "http://localhost:8283"
      LETTA_PASSWORD: "letta_admin_token"
      HERMES_DASHBOARD_URL: "http://localhost:9119"
```

Verify with:

```bash
hermes mcp test memory
```

Should report Connected + 3 tools (memory_write, memory_read, memory_tiers).

## Tools

- `memory_write({content, role, session, agent_id, organization_id, user_id?, metadata?})` — fan-out write to every enabled tier in parallel
- `memory_read({query, session, agent_id, organization_id, user_id?, limit?})` — fan-out search, returns merged snippets tagged with source tier
- `memory_tiers()` — list which tiers are enabled in this process

## Notes

Same ID sanitization rules as the Next.js adapter (`[^a-zA-Z0-9_-]` → `_`) so the two sides stay in sync on workspace/peer/session naming. mem0 writes can take 60-120s on CPU because the LLM fact extraction (llama3.2:1b via Ollama) is slow without a GPU.

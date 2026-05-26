#!/usr/bin/env python3
"""
mcp-memory — stdio MCP server exposing the 4-tier memory chain
(Hermes SQLite + Honcho + mem0 + Letta) as tools the Hermes agent
itself can call inside its loop.

This is the inverse of `src/lib/memory/index.ts`: that file is the
Next.js side that writes / reads memory from the dashboard surface;
this is the Hermes side, registered via `hermes mcp add memory --command
python3 --args /opt/services/mcp-memory/server.py`, so the agent can
issue `tool:memory.write({...})` and `tool:memory.read({...})` from
inside its own reasoning loop and get persistent context across turns.

Three tools:
  memory_write(content, role, session, agent_id, organization_id, user_id?)
  memory_read(query, session, agent_id, organization_id, user_id?, limit?)
  memory_tiers()  → list which tiers are enabled

Tiers configured by MEMORY_TIERS env (same as the Next.js adapter
chain). Defaults to "hermes" only.

Requires the `mcp` Python package (`pip install mcp`). Hermes
auto-discovers MCP servers added via `hermes mcp add`.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import urllib.parse
from typing import Any

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent


HONCHO_BASE_URL = os.environ.get("HONCHO_BASE_URL", "http://localhost:8001").rstrip("/")
MEM0_BASE_URL = os.environ.get("MEM0_BASE_URL", "http://localhost:8765").rstrip("/")
LETTA_BASE_URL = os.environ.get("LETTA_BASE_URL", "http://localhost:8283").rstrip("/")
LETTA_PASSWORD = os.environ.get("LETTA_PASSWORD", "")
HERMES_DASHBOARD_URL = os.environ.get("HERMES_DASHBOARD_URL", "http://localhost:9119").rstrip("/")
TIERS = [t.strip() for t in os.environ.get("MEMORY_TIERS", "hermes").split(",") if t.strip()]

_SAN = re.compile(r"[^a-zA-Z0-9_-]")


def sanitize(s: str) -> str:
    return _SAN.sub("_", s)


_hermes_token_cache: dict[str, str] = {}


async def scrape_hermes_token(client: httpx.AsyncClient) -> str:
    if "tok" in _hermes_token_cache:
        return _hermes_token_cache["tok"]
    env = os.environ.get("HERMES_DASHBOARD_TOKEN", "").strip()
    if env:
        _hermes_token_cache["tok"] = env
        return env
    r = await client.get(f"{HERMES_DASHBOARD_URL}/")
    r.raise_for_status()
    m = re.search(r"[A-Za-z0-9_-]{43}", r.text)
    if not m:
        return ""
    _hermes_token_cache["tok"] = m.group(0)
    return _hermes_token_cache["tok"]


async def honcho_ensure_chain(client: httpx.AsyncClient, ws: str, peer: str, session: str) -> None:
    # Best-effort upserts; ignore errors (404 on re-create is fine).
    for path, body in [
        ("/v3/workspaces", {"id": ws}),
        (f"/v3/workspaces/{ws}/peers", {"id": peer}),
        (f"/v3/workspaces/{ws}/peers/{peer}/sessions", {"id": session}),
    ]:
        try:
            await client.post(f"{HONCHO_BASE_URL}{path}", json=body, timeout=5)
        except Exception:
            pass


async def honcho_write(client: httpx.AsyncClient, *, organization_id: str, agent_id: str,
                       user_id: str | None, session: str, role: str, content: str,
                       metadata: dict[str, Any]) -> dict[str, Any]:
    ws = f"rgaios_{sanitize(organization_id)}"
    peer = sanitize(user_id or f"agent_{agent_id}")
    sess = sanitize(session)
    await honcho_ensure_chain(client, ws, peer, sess)
    r = await client.post(
        f"{HONCHO_BASE_URL}/v3/workspaces/{ws}/sessions/{sess}/messages",
        json={"messages": [{"peer_id": peer, "content": content, "metadata": {**metadata, "role": role}}]},
        timeout=10,
    )
    return {"tier": "honcho", "status": r.status_code, "data": r.json() if r.status_code < 400 else r.text}


async def honcho_read(client: httpx.AsyncClient, *, organization_id: str, agent_id: str,
                      user_id: str | None, query: str, limit: int) -> list[dict[str, Any]]:
    ws = f"rgaios_{sanitize(organization_id)}"
    peer = sanitize(user_id or f"agent_{agent_id}")
    try:
        r = await client.post(
            f"{HONCHO_BASE_URL}/v3/workspaces/{ws}/peers/{peer}/search",
            json={"query": query, "limit": limit},
            timeout=10,
        )
        if r.status_code >= 400:
            return []
        data = r.json()
        items = data.get("results") or data.get("items") or []
        return [{"source": "honcho", "content": i.get("content", ""), "score": i.get("score")} for i in items]
    except Exception:
        return []


async def mem0_write(client: httpx.AsyncClient, *, organization_id: str, agent_id: str,
                     user_id: str | None, session: str, role: str, content: str,
                     metadata: dict[str, Any]) -> dict[str, Any]:
    uid = user_id or f"agent_{agent_id}"
    try:
        r = await client.post(
            f"{MEM0_BASE_URL}/api/v1/memories/",
            json={"user_id": uid, "text": content, "app": "rawclaw",
                  "metadata": {**metadata, "role": role, "organization_id": organization_id, "session": session}},
            follow_redirects=True, timeout=120,
        )
        return {"tier": "mem0", "status": r.status_code,
                "data": r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text}
    except Exception as e:
        return {"tier": "mem0", "status": 0, "error": str(e)}


async def mem0_read(client: httpx.AsyncClient, *, organization_id: str, agent_id: str,
                    user_id: str | None, query: str, limit: int) -> list[dict[str, Any]]:
    uid = user_id or f"agent_{agent_id}"
    try:
        qs = urllib.parse.urlencode({"user_id": uid, "search_query": query, "size": limit})
        r = await client.get(f"{MEM0_BASE_URL}/api/v1/memories/?{qs}", follow_redirects=True, timeout=15)
        if r.status_code >= 400:
            return []
        data = r.json()
        items = data.get("items") or []
        return [{"source": "mem0", "content": i.get("content") or i.get("memory", ""), "score": i.get("score")} for i in items]
    except Exception:
        return []


async def letta_headers() -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if LETTA_PASSWORD:
        h["Authorization"] = f"Bearer {LETTA_PASSWORD}"
    return h


async def letta_ensure_agent(client: httpx.AsyncClient, organization_id: str, agent_id: str,
                              user_id: str | None) -> str:
    name = sanitize(f"rgaios_{organization_id}_{agent_id}_{user_id or 'default'}")
    try:
        r = await client.post(f"{LETTA_BASE_URL}/v1/agents/",
                              headers=await letta_headers(),
                              json={"name": name}, timeout=10)
        if r.status_code < 400:
            data = r.json()
            return data.get("id") or name
    except Exception:
        pass
    return name


async def letta_write(client: httpx.AsyncClient, *, organization_id: str, agent_id: str,
                      user_id: str | None, session: str, role: str, content: str,
                      metadata: dict[str, Any]) -> dict[str, Any]:
    aid = await letta_ensure_agent(client, organization_id, agent_id, user_id)
    try:
        r = await client.post(
            f"{LETTA_BASE_URL}/v1/agents/{aid}/archival-memory",
            headers=await letta_headers(),
            json={"text": content}, timeout=30,
        )
        return {"tier": "letta", "status": r.status_code,
                "data": r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text}
    except Exception as e:
        return {"tier": "letta", "status": 0, "error": str(e)}


async def letta_read(client: httpx.AsyncClient, *, organization_id: str, agent_id: str,
                     user_id: str | None, query: str, limit: int) -> list[dict[str, Any]]:
    aid = await letta_ensure_agent(client, organization_id, agent_id, user_id)
    try:
        r = await client.post(
            f"{LETTA_BASE_URL}/v1/agents/{aid}/archival-memory/search",
            headers=await letta_headers(),
            json={"query": query, "limit": limit}, timeout=15,
        )
        if r.status_code >= 400:
            return []
        data = r.json()
        items = data if isinstance(data, list) else data.get("passages", [])
        return [{"source": "letta", "content": i.get("text") or i.get("content", ""), "score": i.get("score")} for i in items]
    except Exception:
        return []


async def hermes_local_read(client: httpx.AsyncClient, *, session: str, limit: int) -> list[dict[str, Any]]:
    try:
        tok = await scrape_hermes_token(client)
        headers = {"X-Hermes-Session-Token": tok} if tok else {}
        r = await client.get(
            f"{HERMES_DASHBOARD_URL}/api/sessions/{urllib.parse.quote(session)}/messages",
            headers=headers, timeout=10,
        )
        if r.status_code >= 400:
            return []
        data = r.json()
        items = data if isinstance(data, list) else data.get("messages", [])
        return [{"source": "hermes", "content": i.get("content", ""), "score": None}
                for i in items[-limit:]]
    except Exception:
        return []


async def fan_write(args: dict[str, Any]) -> list[dict[str, Any]]:
    async with httpx.AsyncClient() as client:
        tasks = []
        if "honcho" in TIERS:
            tasks.append(honcho_write(client, **args))
        if "mem0" in TIERS:
            tasks.append(mem0_write(client, **args))
        if "letta" in TIERS:
            tasks.append(letta_write(client, **args))
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return [r if not isinstance(r, Exception) else {"tier": "?", "error": str(r)}
                for r in results]


async def fan_read(args: dict[str, Any]) -> list[dict[str, Any]]:
    async with httpx.AsyncClient() as client:
        tasks = []
        if "hermes" in TIERS:
            tasks.append(hermes_local_read(client, session=args["session"], limit=args["limit"]))
        if "honcho" in TIERS:
            tasks.append(honcho_read(client, **{k: args[k] for k in ("organization_id", "agent_id", "user_id", "query", "limit")}))
        if "mem0" in TIERS:
            tasks.append(mem0_read(client, **{k: args[k] for k in ("organization_id", "agent_id", "user_id", "query", "limit")}))
        if "letta" in TIERS:
            tasks.append(letta_read(client, **{k: args[k] for k in ("organization_id", "agent_id", "user_id", "query", "limit")}))
        results = await asyncio.gather(*tasks, return_exceptions=True)
        out: list[dict[str, Any]] = []
        for r in results:
            if isinstance(r, Exception):
                continue
            out.extend(r)
        return out


# ---------------------------------------------------------------------------
# MCP server
# ---------------------------------------------------------------------------

app = Server("rawgrowth-memory")


@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="memory_write",
            description=("Append a turn to every enabled memory tier in parallel "
                         "(Honcho + mem0 + Letta + Hermes local). Returns per-tier write results."),
            inputSchema={
                "type": "object",
                "properties": {
                    "content": {"type": "string"},
                    "role": {"type": "string", "enum": ["user", "assistant", "system", "tool"]},
                    "session": {"type": "string"},
                    "agent_id": {"type": "string"},
                    "organization_id": {"type": "string"},
                    "user_id": {"type": "string"},
                    "metadata": {"type": "object"},
                },
                "required": ["content", "role", "session", "agent_id", "organization_id"],
            },
        ),
        Tool(
            name="memory_read",
            description=("Search every enabled memory tier in parallel and return merged snippets. "
                         "Each snippet is tagged with its source tier (hermes / honcho / mem0 / letta)."),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "session": {"type": "string"},
                    "agent_id": {"type": "string"},
                    "organization_id": {"type": "string"},
                    "user_id": {"type": "string"},
                    "limit": {"type": "integer", "default": 5},
                },
                "required": ["query", "session", "agent_id", "organization_id"],
            },
        ),
        Tool(
            name="memory_tiers",
            description="List which memory tiers are enabled in this process (MEMORY_TIERS env).",
            inputSchema={"type": "object", "properties": {}},
        ),
    ]


@app.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    if name == "memory_tiers":
        return [TextContent(type="text", text=json.dumps({"tiers": TIERS}))]
    if name == "memory_write":
        args = {
            "organization_id": arguments["organization_id"],
            "agent_id": arguments["agent_id"],
            "user_id": arguments.get("user_id"),
            "session": arguments["session"],
            "role": arguments["role"],
            "content": arguments["content"],
            "metadata": arguments.get("metadata") or {},
        }
        results = await fan_write(args)
        return [TextContent(type="text", text=json.dumps({"tiers": TIERS, "writes": results}, default=str))]
    if name == "memory_read":
        args = {
            "organization_id": arguments["organization_id"],
            "agent_id": arguments["agent_id"],
            "user_id": arguments.get("user_id"),
            "session": arguments["session"],
            "query": arguments["query"],
            "limit": int(arguments.get("limit", 5)),
        }
        snippets = await fan_read(args)
        return [TextContent(type="text", text=json.dumps({"tiers": TIERS, "snippets": snippets}, default=str))]
    raise ValueError(f"unknown tool: {name}")


async def main() -> None:
    async with stdio_server() as (read, write):
        await app.run(read, write, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())

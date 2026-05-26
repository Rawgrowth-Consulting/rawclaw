#!/usr/bin/env python3
"""
Minimal standalone status UI for the self-healing/learning agent stack.

Runs on Admin at :9120 until Rami's full Next.js dashboard ships. Lets
an operator:

  - See which memory tiers are enabled
  - Score arbitrary text via self_heal_score (live MCP round-trip)
  - Read the last N snippets from the 4-tier memory chain for any
    organization/session pair

No deps beyond stdlib + the existing mcp client already in the venv.
Run with:
  cd /opt/rawclaw/services/mcp-memory
  .venv/bin/python status_ui.py        # binds 0.0.0.0:9120
"""
from __future__ import annotations

import asyncio
import html
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

HERE = os.path.dirname(os.path.abspath(__file__))
PY = os.path.join(HERE, ".venv", "bin", "python")
SERVER = os.path.join(HERE, "server.py")
PORT = int(os.environ.get("STATUS_UI_PORT", "9120"))


async def call_tool(name: str, args: dict) -> str:
    params = StdioServerParameters(command=PY, args=[SERVER], env=os.environ.copy())
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            result = await s.call_tool(name, args)
            return result.content[0].text if result.content else "{}"


def run_async(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>Self-heal status</title>
<style>
  body {{ font: 14px ui-sans-serif, system-ui; max-width: 900px; margin: 2em auto; padding: 0 1em; color: #111 }}
  h1 {{ font-size: 1.2em }}
  h2 {{ font-size: 1em; margin-top: 2em; border-bottom: 1px solid #ddd; padding-bottom: 4px }}
  textarea, input {{ font: inherit; width: 100%; padding: 6px; box-sizing: border-box }}
  button {{ font: inherit; padding: 6px 14px; background: #111; color: #fff; border: 0; cursor: pointer }}
  pre {{ background: #f5f5f5; padding: 8px; overflow-x: auto; font-size: 12px }}
  .pill {{ display: inline-block; padding: 2px 8px; background: #eee; border-radius: 10px; margin-right: 4px; font-size: 12px }}
  form {{ margin: 0 }}
</style></head>
<body>
<h1>Rawgrowth: self-healing / self-learning agent status</h1>
<p>Live MCP surface on Admin VPS. Each form call invokes the same stdio MCP server the Hermes agent uses internally.</p>

<h2>Memory tiers enabled</h2>
<p>{tiers_pills}</p>

<h2>Score a draft (self_heal_score)</h2>
<form method="post" action="/score">
  <textarea name="text" rows="3" placeholder="Paste a candidate reply...">{score_text}</textarea>
  <p><button type="submit">Score</button></p>
</form>
{score_result}

<h2>Read memory (memory_read)</h2>
<form method="post" action="/read">
  <p>Query: <input name="query" value="{read_query}" placeholder="What is Pedro's favorite color?"></p>
  <p>Organization id: <input name="organization_id" value="{read_org}"></p>
  <p>Agent id: <input name="agent_id" value="{read_agent}"></p>
  <p>Session: <input name="session" value="{read_session}"></p>
  <p>Limit: <input name="limit" value="{read_limit}" size="3" style="width:60px"></p>
  <p><button type="submit">Read</button></p>
</form>
{read_result}

<p style="color:#888;margin-top:3em;font-size:12px">v4 / self-heal stack | {extra_line}</p>
</body></html>
"""


def render(
    tiers,
    *,
    score_text="",
    score_result="",
    read_query="",
    read_org="smoke",
    read_agent="scan",
    read_session="demo",
    read_limit="5",
    read_result="",
    extra="",
):
    pills = "".join(f'<span class="pill">{html.escape(t)}</span>' for t in tiers) or "(none)"
    return PAGE.format(
        tiers_pills=pills,
        score_text=html.escape(score_text),
        score_result=score_result,
        read_query=html.escape(read_query),
        read_org=html.escape(read_org),
        read_agent=html.escape(read_agent),
        read_session=html.escape(read_session),
        read_limit=html.escape(str(read_limit)),
        read_result=read_result,
        extra_line=html.escape(extra),
    )


def get_tiers():
    raw = run_async(call_tool("memory_tiers", {}))
    try:
        return json.loads(raw).get("tiers", [])
    except Exception:
        return []


class Handler(BaseHTTPRequestHandler):
    def _send(self, body, status=200):
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        path = urlparse(self.path).path
        if path != "/":
            self._send("not found", 404)
            return
        tiers = get_tiers()
        self._send(render(tiers, extra=f"tiers fetched ok: {len(tiers)}"))

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        form = {k: v[0] for k, v in parse_qs(raw, keep_blank_values=True).items()}
        path = urlparse(self.path).path
        tiers = get_tiers()

        if path == "/score":
            text = form.get("text", "")
            raw_resp = run_async(call_tool("self_heal_score", {"text": text}))
            try:
                obj = json.loads(raw_resp)
                pretty = json.dumps(obj, indent=2)
                verdict = (
                    "clean: safe to emit"
                    if not obj.get("has_error") and obj.get("score", 0) >= 0.5
                    else "dirty: rephrase + retry"
                )
                block = f"<pre>{verdict}\n\n{html.escape(pretty)}</pre>"
            except Exception:
                block = f"<pre>{html.escape(raw_resp)}</pre>"
            self._send(render(tiers, score_text=text, score_result=block))
            return

        if path == "/read":
            args = {
                "query": form.get("query", ""),
                "organization_id": form.get("organization_id", "smoke"),
                "agent_id": form.get("agent_id", "scan"),
                "session": form.get("session", "demo"),
                "limit": int(form.get("limit", "5") or "5"),
            }
            raw_resp = run_async(call_tool("memory_read", args))
            try:
                obj = json.loads(raw_resp)
                snippets = obj.get("snippets", [])
                if snippets:
                    rows = "".join(
                        "<li><b>[{src}]</b> {content} <span style='color:#888'>{score}</span></li>".format(
                            src=html.escape(s.get("source", "?")),
                            content=html.escape((s.get("content") or "")[:300]),
                            score=("score=" + f"{s.get('score'):.3f}") if s.get("score") is not None else "",
                        )
                        for s in snippets
                    )
                    block = f"<p>{len(snippets)} snippets across {len(obj.get('tiers', []))} tier(s)</p><ul>{rows}</ul>"
                else:
                    block = "<p>(no snippets - try a different query/session pair)</p>"
            except Exception:
                block = f"<pre>{html.escape(raw_resp)}</pre>"
            self._send(
                render(
                    tiers,
                    read_query=args["query"],
                    read_org=args["organization_id"],
                    read_agent=args["agent_id"],
                    read_session=args["session"],
                    read_limit=str(args["limit"]),
                    read_result=block,
                )
            )
            return

        self._send("not found", 404)

    def log_message(self, fmt, *args):
        sys.stderr.write("[status_ui] " + (fmt % args) + "\n")


def main():
    bind = os.environ.get("STATUS_UI_BIND", "127.0.0.1")
    srv = ThreadingHTTPServer((bind, PORT), Handler)
    sys.stderr.write(f"[status_ui] listening on {bind}:{PORT}\n")
    srv.serve_forever()


if __name__ == "__main__":
    main()

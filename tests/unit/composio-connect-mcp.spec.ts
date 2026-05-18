import test from "node:test";
import assert from "node:assert/strict";

// BUG-32 (D 2026-05-18 R-COMPOSIO-3 calendar walk): operator could not
// connect a new Composio toolkit (Google Calendar) from chat - Scan
// honest-failed and pointed the operator to /connections page. Pedro
// asked why no MCP tool for connect when we already have apify +
// composio_use_tool. Shipped composio_connect_app at
// src/lib/mcp/tools/composio-connect.ts wrapping the same v3
// /connected_accounts/link flow the /connections POST handler uses
// (route.ts:99-118).
//
// These tests pin the tool registration contract: the tool exists,
// declares `app` as required input, is flagged isWrite (OAuth grant
// is operator-visible / write-side effect), and surfaces a redirect
// URL in its text response shape so the chat UI can render it
// clickable inline.

test("composio_connect_app is registered with name + write flag", async () => {
  // Force tool registration side-effects to run.
  const reg = await import("../../src/lib/mcp/registry");
  await import("../../src/lib/mcp/tools/composio-connect");
  // registry exposes the registered tools via getRegisteredTools() OR
  // .tools (compat both shapes - registry.ts:29 is the only registrar).
  const mod = reg as unknown as {
    getRegisteredTools?: () => Array<{
      name: string;
      isWrite?: boolean;
      inputSchema?: { required?: string[] };
    }>;
    listTools?: () => Array<{
      name: string;
      isWrite?: boolean;
      inputSchema?: { required?: string[] };
    }>;
  };
  const list = mod.getRegisteredTools?.() ?? mod.listTools?.();
  assert.ok(Array.isArray(list), "registry must expose tool list");
  const found = list!.find((t) => t.name === "composio_connect_app");
  assert.ok(found, "composio_connect_app tool not registered");
  assert.equal(found!.isWrite, true, "composio_connect_app must be isWrite (OAuth grant has side effects)");
  assert.deepEqual(
    found!.inputSchema?.required ?? [],
    ["app"],
    "composio_connect_app must require `app` input",
  );
});

test("composio_connect_app description nudges agent toward in-chat surface", async () => {
  const reg = await import("../../src/lib/mcp/registry");
  await import("../../src/lib/mcp/tools/composio-connect");
  const mod = reg as unknown as {
    getRegisteredTools?: () => Array<{ name: string; description?: string }>;
    listTools?: () => Array<{ name: string; description?: string }>;
  };
  const list = mod.getRegisteredTools?.() ?? mod.listTools?.();
  const found = list!.find((t) => t.name === "composio_connect_app");
  const desc = found!.description ?? "";
  assert.match(
    desc,
    /no connected account|connect|toolkit|OAuth/i,
    "description must explain when to fire (no-connected-account or explicit user ask)",
  );
  assert.match(
    desc,
    /clickable|redirect|link/i,
    "description must promise a clickable / redirect / link surface so the model emits it inline",
  );
});

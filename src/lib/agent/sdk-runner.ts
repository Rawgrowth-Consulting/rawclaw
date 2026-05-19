/**
 * sdk-runner.ts — Agent SDK wrapper for Rawclaw v3.
 *
 * Replaces the multi-provider chatComplete / generateText abstraction with
 * the Claude Agent SDK's `query()`. Each agent runs as a full Claude Code
 * instance with native tools (Bash, Read, Write, Edit, WebSearch, etc.)
 * plus additive MCP tools (Composio, knowledge, etc.) via the v3 MCP server.
 *
 * This is the same pattern the original Rawclaw used — agents ARE Claude Code.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

/**
 * Raised when the Claude Code CLI subprocess fails because Anthropic
 * revoked the Claude Max OAuth access_token (BUG-44). chat-sdk.ts
 * catches this specifically and routes through claude-max-recovery
 * instead of bubbling the failure to the operator. Subclass of Error
 * so existing instanceof Error checks elsewhere still match.
 */
export class AuthRevokedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthRevokedError";
  }
}

/**
 * Inspect a raw SDK error message for the three canonical wordings the
 * Claude Code CLI emits when its OAuth credential is rejected. Kept in
 * sync with looksLikeAuthFail in claude-max-recovery.ts - both must
 * agree or the recovery branch never fires.
 */
function isAuthRevokedMessage(msg: string): boolean {
  return /invalid authentication credentials|not logged in|please run \/login|unauthorized|\b401\b/i.test(
    msg,
  );
}

export interface SdkRunResult {
  text: string | null;
  sessionId: string | undefined;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    totalCostUsd: number;
  } | null;
  aborted?: boolean;
}

export interface SdkRunOptions {
  /** The user's message */
  message: string;
  /** System prompt / preamble (injected as CLAUDE.md content) */
  systemPrompt: string;
  /** Session ID to resume (persistent context across messages) */
  sessionId?: string;
  /** Working directory for the agent — where its CLAUDE.md lives */
  cwd?: string;
  /** Model override (e.g. 'claude-sonnet-4-6', 'claude-opus-4-6') */
  model?: string;
  /** Abort controller for cancellation */
  abortController?: AbortController;
  /** Called on streaming text deltas */
  onStreamText?: (accumulated: string) => void;
  /** Called when typing indicator should refresh */
  onTyping?: () => void;
  /** MCP config for additive tools (Composio, knowledge, etc.) */
  mcpConfigPath?: string;
  /** Max wall-clock time in ms (default: 120s) */
  timeoutMs?: number;
}

/**
 * Write a temporary CLAUDE.md file for the agent's workspace.
 * This is how the Agent SDK picks up the system prompt — via
 * settingSources: ['project'] reading CLAUDE.md from cwd.
 *
 * BUG-1 FIX (D TICK-31, 2026-05-17): each call creates a fresh per-
 * run subdirectory under the agent's slot instead of reusing the
 * deterministic `<base>/<agentId>` path. The Agent SDK's
 * `settingSources: ['project']` reads CLAUDE.md AND every other
 * file in the cwd as project context, so when the previous version
 * shared the directory across runs the SDK pulled stale intermediate
 * todo.md / scratch.md / notes from prior turns and contaminated the
 * fresh session. Operator-visible symptom: "session stale between
 * turns" + the clear+new-chat manual workaround that A relied on.
 *
 * Per-run isolation: `<base>/<agentId>/<random>` keeps the agent-
 * scoped slot for ops debugging (`ls /tmp/rawclaw-agents/<id>/`
 * shows every run that touched that agent) while guaranteeing each
 * run starts on an empty cwd. Caller is expected to invoke
 * `cleanupAgentWorkspace` in a `finally` block to free the temp
 * dir; if cleanup is skipped the OS /tmp janitor eventually wins,
 * the bug is no longer that the stale files leak into the NEXT
 * run.
 */
async function ensureAgentWorkspace(
  agentId: string,
  systemPrompt: string,
): Promise<string> {
  const workspaceBase =
    process.env.AGENT_WORKSPACE_DIR ?? "/tmp/rawclaw-agents";
  const agentSlot = path.join(workspaceBase, agentId);
  await fs.mkdir(agentSlot, { recursive: true });
  // mkdtemp creates a unique directory with a random suffix appended
  // to the prefix - the trailing slash on the prefix tells it to put
  // the random part as the directory name inside agentSlot.
  const agentDir = await fs.mkdtemp(path.join(agentSlot, "run-"));
  await fs.writeFile(path.join(agentDir, "CLAUDE.md"), systemPrompt, "utf-8");
  return agentDir;
}

/**
 * Remove a per-run agent workspace created by `ensureAgentWorkspace`.
 * Best-effort: cleanup failure logs and swallows so it never blocks
 * the caller's `finally`. Idempotent on a missing path.
 */
export async function cleanupAgentWorkspace(agentDir: string): Promise<void> {
  try {
    await fs.rm(agentDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(
      `[sdk-runner] cleanupAgentWorkspace failed for ${agentDir}: ${(err as Error).message}`,
    );
  }
}

/**
 * Write an MCP config file pointing to the v3 app's /api/mcp endpoint.
 *
 * Returns the path to a temp project-scope config (passed via the SDK's
 * `mcpConfigPath` option) AND simultaneously merges the same server into
 * the subprocess's user-scope `~/.claude.json` settings file.
 *
 * Why both: Anthropic Claude Code subagents + project-scope MCP
 * (`--mcp-config` flag) silently hallucinate "tool unavailable" - bugs
 * #13898 + #14496 + #13254. User-scope MCP (~/.claude.json mcpServers)
 * does propagate to subagents + Task tool forks. Wiring both is
 * belt-and-suspenders: main agent uses project-scope as before; any
 * subagent the main spawns inherits via user-scope.
 *
 * Single-tenant assumption: each per-client VPS runs one org, so writing
 * the org's mcp_token into the shared user-scope file is safe. Multi-org
 * containers would need per-run user dirs (HOME=/tmp/agent-<id>/.claude).
 */
export async function writeMcpConfig(
  appUrl: string,
  mcpToken: string,
): Promise<string> {
  const endpoint = `${appUrl.replace(/\/$/, "")}/api/mcp`;
  const serverDef = {
    type: "http",
    url: endpoint,
    headers: { Authorization: `Bearer ${mcpToken}` },
  };
  const cfg = { mcpServers: { rawgrowth: serverDef } };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rawclaw-mcp-"));
  const configPath = path.join(dir, "mcp.json");
  await fs.writeFile(configPath, JSON.stringify(cfg), { mode: 0o600 });

  // Subagent-bypass leg: ensure the same server is registered at
  // user-scope so Task tool forks see it. The SDK subprocess inherits
  // HOME from runAgentSdk's env override (CLAUDE_CLI_HOME ?? HOME ??
  // "/home/node"); read that exact precedence here so we patch the
  // file the CLI will actually load.
  const home =
    process.env.CLAUDE_CLI_HOME ?? process.env.HOME ?? "/home/node";
  const userClaudeJson = path.join(home, ".claude.json");
  try {
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await fs.readFile(userClaudeJson, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      // file missing or unreadable: create from scratch
    }
    const servers = (existing.mcpServers as Record<string, unknown>) ?? {};
    servers.rawgrowth = serverDef;
    existing.mcpServers = servers;
    const tmp = userClaudeJson + ".new";
    await fs.writeFile(tmp, JSON.stringify(existing, null, 2));
    await fs.rename(tmp, userClaudeJson);
  } catch (err) {
    // Non-fatal: project-scope path still works for main agent.
    console.warn(
      `[writeMcpConfig] user-scope merge skipped: ${(err as Error).message}`,
    );
  }

  return configPath;
}

/**
 * Clean up a temporary MCP config file.
 */
export async function cleanupMcpConfig(configPath: string): Promise<void> {
  try {
    await fs.unlink(configPath);
    await fs.rmdir(path.dirname(configPath));
  } catch {
    // best-effort cleanup
  }
}

/**
 * AsyncGenerator that yields a single user message for the Agent SDK.
 */
async function* singleTurn(text: string) {
  yield {
    type: "user" as const,
    message: { role: "user" as const, content: text },
    parent_tool_use_id: null,
    session_id: "",
  };
}

/**
 * Run a message through the Claude Agent SDK.
 *
 * This spawns an actual Claude Code instance with full native capabilities:
 * Bash, Read, Write, Edit, Grep, Glob, WebSearch, WebFetch, Agent (sub-agents).
 *
 * MCP tools (Composio, knowledge, etc.) are additive on top — not replacements.
 *
 * Auth: The SDK spawns `claude` CLI which reads OAuth auth from ~/.claude/
 * automatically. No explicit token needed.
 */
export async function runAgentSdk(
  opts: SdkRunOptions,
): Promise<SdkRunResult> {
  const {
    message,
    systemPrompt,
    sessionId,
    cwd,
    model,
    abortController,
    onStreamText,
    onTyping,
    mcpConfigPath,
    timeoutMs = 120_000,
  } = opts;

  // Set up typing indicator refresh (Telegram's typing expires after ~5s)
  const typingInterval = onTyping ? setInterval(onTyping, 4000) : null;

  // Auto-abort after wall-clock timeout
  const timeoutAc = new AbortController();
  const timer = setTimeout(() => timeoutAc.abort(), timeoutMs);
  const signal = abortController?.signal ?? timeoutAc.signal;

  let newSessionId: string | undefined;
  let resultText: string | null = null;
  let streamedText = "";
  let usage: SdkRunResult["usage"] = null;

  try {
    const sdkOptions: Partial<Options> = {
      // Agent working directory — CLAUDE.md loaded from here
      cwd: cwd ?? process.cwd(),

      // Resume previous session for persistent context
      ...(sessionId ? { resume: sessionId } : {}),

      // Load CLAUDE.md from cwd + user skills from ~/.claude/
      settingSources: ["project", "user"],

      // Full permissions — agents own their department
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,

      // Pass environment to subprocess (HOME for .claude/ auth)
      env: {
        ...process.env,
        HOME: process.env.CLAUDE_CLI_HOME ?? process.env.HOME ?? "/home/node",
        // BUG-44b (A 2026-05-19): CLI reads ANTHROPIC_API_KEY env
        // directly when file-credentials is stale; explicit
        // pass-through ensures recovery path works even if a future
        // refactor narrows the `...process.env` spread above.
        ...(process.env.ANTHROPIC_API_KEY
          ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
          : {}),
      },

      // Stream text for progressive updates
      includePartialMessages: !!onStreamText,

      // Model override
      ...(model ? { model } : {}),

      // Abort support
      abortController: abortController ?? timeoutAc,

      // MCP config for additive tools
      ...(mcpConfigPath ? { mcpConfigPath } : {}),

      // Max turns to prevent runaway loops
      maxTurns: 30,
    };

    for await (const event of query({
      prompt: singleTurn(message),
      options: sdkOptions as Options,
    })) {
      const ev = event as Record<string, unknown>;

      // Session init
      if (ev.type === "system" && ev.subtype === "init") {
        newSessionId = ev.session_id as string;
      }

      // Stream text deltas
      if (ev.type === "stream_event" && onStreamText && ev.parent_tool_use_id === null) {
        const streamEvent = ev.event as Record<string, unknown> | undefined;
        if (streamEvent?.type === "content_block_delta") {
          const delta = streamEvent.delta as Record<string, unknown> | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            streamedText += delta.text;
            onStreamText(streamedText);
          }
        }
        if (streamEvent?.type === "message_start") {
          streamedText = "";
        }
      }

      // Final result
      if (ev.type === "result") {
        resultText = (ev.result as string | null | undefined) ?? null;
        const evUsage = ev.usage as Record<string, number> | undefined;
        if (evUsage) {
          usage = {
            inputTokens: evUsage.input_tokens ?? 0,
            outputTokens: evUsage.output_tokens ?? 0,
            cacheReadInputTokens: evUsage.cache_read_input_tokens ?? 0,
            totalCostUsd: (ev.total_cost_usd as number) ?? 0,
          };
        }
      }
    }
  } catch (err) {
    if (signal.aborted) {
      // BUG-43: surface partial stream on abort instead of dropping it.
      // GAIA-style multi-hop reasoning hits 500s timeoutMs and was returning
      // EMPTY even when streamedText already had ~hundreds of chars in flight.
      // Caller checks result.aborted to know it was truncated.
      return { text: streamedText || null, sessionId: newSessionId, usage, aborted: true };
    }
    // BUG-44 (2026-05-19): the SDK shells out to the Claude Code CLI,
    // which reads ~/.claude/.credentials.json for OAuth. Anthropic
    // occasionally revokes access_tokens server-side; the CLI then
    // emits "Not logged in" / "Invalid authentication credentials" /
    // 401 via stderr and the SDK rethrows it as a generic Error.
    // Re-wrap as AuthRevokedError so chat-sdk's recovery branch can
    // detect it via instanceof or by message and trigger the
    // refresh_token rotation in claude-max-recovery.
    const rawMsg = err instanceof Error ? err.message : String(err);
    if (isAuthRevokedMessage(rawMsg)) {
      throw new AuthRevokedError(rawMsg);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (typingInterval) clearInterval(typingInterval);
  }

  return { text: resultText, sessionId: newSessionId, usage };
}

export { ensureAgentWorkspace };

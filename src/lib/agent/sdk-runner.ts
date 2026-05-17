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
 */
async function ensureAgentWorkspace(
  agentId: string,
  systemPrompt: string,
): Promise<string> {
  const workspaceBase =
    process.env.AGENT_WORKSPACE_DIR ?? "/tmp/rawclaw-agents";
  const agentDir = path.join(workspaceBase, agentId);
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(path.join(agentDir, "CLAUDE.md"), systemPrompt, "utf-8");
  return agentDir;
}

/**
 * Write a temporary MCP config file pointing to the v3 app's /api/mcp endpoint.
 * This gives agents access to Composio tools, knowledge queries, etc.
 * as ADDITIVE capabilities on top of native Claude Code tools.
 */
export async function writeMcpConfig(
  appUrl: string,
  mcpToken: string,
): Promise<string> {
  const cfg = {
    mcpServers: {
      rawgrowth: {
        type: "http",
        url: `${appUrl.replace(/\/$/, "")}/api/mcp`,
        headers: { Authorization: `Bearer ${mcpToken}` },
      },
    },
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rawclaw-mcp-"));
  const configPath = path.join(dir, "mcp.json");
  await fs.writeFile(configPath, JSON.stringify(cfg), { mode: 0o600 });
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
      return { text: null, sessionId: newSessionId, usage, aborted: true };
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (typingInterval) clearInterval(typingInterval);
  }

  return { text: resultText, sessionId: newSessionId, usage };
}

export { ensureAgentWorkspace };

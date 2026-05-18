import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";

/**
 * Unit tests for src/lib/agent/sdk-runner.ts:
 *   - `ensureAgentWorkspace(agentId, systemPrompt)` - creates a fresh
 *     per-run subdirectory under `<base>/<agentId>/run-*` and writes
 *     CLAUDE.md into it.
 *   - `cleanupAgentWorkspace(agentDir)` - best-effort `fs.rm`.
 *
 * Background: PR #128 (D TICK-31) fixed BUG-1 ("SDK session stale
 * between turns") by giving every call its own cwd. The Agent SDK
 * reads CLAUDE.md AND every other file in the cwd as project context
 * via `settingSources: ['project']`, so without per-run isolation a
 * prior turn's todo.md / scratch leaked into the next session.
 *
 * These tests lock the per-run-subdir invariant: two consecutive
 * calls for the SAME agent must hand back DIFFERENT directories.
 * If a future refactor reverts to the deterministic `<base>/<agentId>`
 * path, these specs flip red.
 */

let workspaceBase: string;
let envSnap: string | undefined;

beforeEach(async () => {
  envSnap = process.env.AGENT_WORKSPACE_DIR;
  // Test-scoped base under the OS temp dir so the suite never
  // touches the production `/tmp/rawclaw-agents` slot. Random
  // suffix keeps parallel test runs from racing.
  workspaceBase = await fs.mkdtemp(
    path.join(os.tmpdir(), "sdk-runner-spec-"),
  );
  process.env.AGENT_WORKSPACE_DIR = workspaceBase;
});

afterEach(async () => {
  // Restore env + clean up our scratch base.
  if (envSnap === undefined) delete process.env.AGENT_WORKSPACE_DIR;
  else process.env.AGENT_WORKSPACE_DIR = envSnap;
  await fs.rm(workspaceBase, { recursive: true, force: true });
});

test("ensureAgentWorkspace: two calls for the same agent return DIFFERENT dirs (BUG-1 fix)", async () => {
  const sdk = await import("@/lib/agent/sdk-runner");
  const agentId = "agent-uuid-xyz";
  const dirA = await sdk.ensureAgentWorkspace(agentId, "# A first prompt\n");
  const dirB = await sdk.ensureAgentWorkspace(agentId, "# A second prompt\n");
  assert.notEqual(
    dirA,
    dirB,
    "per-run subdir must differ between calls or stale cwd contamination returns (BUG-1)",
  );
  // Both must sit under the agent-scoped slot so ops can still list
  // every run that touched the agent.
  const expectedSlot = path.join(workspaceBase, agentId);
  assert.ok(
    dirA.startsWith(expectedSlot),
    `dirA must live under ${expectedSlot}, got ${dirA}`,
  );
  assert.ok(
    dirB.startsWith(expectedSlot),
    `dirB must live under ${expectedSlot}, got ${dirB}`,
  );
  // The run prefix anchors the random suffix - keeps the per-run
  // dirs visually distinct from any future non-run sibling.
  assert.match(path.basename(dirA), /^run-/);
  assert.match(path.basename(dirB), /^run-/);
});

test("ensureAgentWorkspace: writes CLAUDE.md verbatim into the per-run dir", async () => {
  const sdk = await import("@/lib/agent/sdk-runner");
  const prompt =
    "# Test Agent\nYou are a unit-test stub. Reply with 'ok'.";
  const dir = await sdk.ensureAgentWorkspace("agent-uuid-1", prompt);
  const written = await fs.readFile(path.join(dir, "CLAUDE.md"), "utf-8");
  assert.equal(written, prompt);
});

test("cleanupAgentWorkspace: removes the per-run dir (BUG-1 cleanup)", async () => {
  const sdk = await import("@/lib/agent/sdk-runner");
  const dir = await sdk.ensureAgentWorkspace(
    "agent-uuid-1",
    "# cleanup test",
  );
  // Sanity: the dir + CLAUDE.md exist before cleanup.
  const before = await fs.stat(dir);
  assert.ok(before.isDirectory());

  await sdk.cleanupAgentWorkspace(dir);

  await assert.rejects(
    fs.stat(dir),
    /ENOENT/,
    "cleanupAgentWorkspace must remove the per-run dir entirely",
  );
});

test("cleanupAgentWorkspace: missing path is a no-op (idempotent)", async () => {
  const sdk = await import("@/lib/agent/sdk-runner");
  // Construct a path that definitely doesn't exist. cleanup must
  // swallow the ENOENT and resolve normally - callers wrap it in a
  // `finally`, so throwing here would mask the real failure.
  const missing = path.join(workspaceBase, "never-created");
  await sdk.cleanupAgentWorkspace(missing);
});

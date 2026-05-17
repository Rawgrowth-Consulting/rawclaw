import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AUDIT_RETENTION_DAYS,
  runAuditRetentionTick,
} from "../../src/workers/audit-retention-prune";

/**
 * Pure-function contracts for the audit-retention worker. The
 * supabase round-trip is injected via deps.rpc so this file stays
 * free of network fixtures.
 */

test("default retention = 90 days per F-6 spec", () => {
  assert.equal(DEFAULT_AUDIT_RETENTION_DAYS, 90);
});

test("forwards retention_days arg to the RPC call", async () => {
  let captured: { fn: string; args: unknown } | null = null;
  const result = await runAuditRetentionTick(30, {
    rpc: async (fn, args) => {
      captured = { fn, args };
      return { data: 17, error: null };
    },
  });
  assert.deepEqual(captured, {
    fn: "rgaios_audit_log_prune",
    args: { retention_days: 30 },
  });
  assert.equal(result.deleted, 17);
});

test("passes default 90 when no arg given", async () => {
  let capturedArgs: unknown = null;
  await runAuditRetentionTick(undefined as unknown as number, {
    rpc: async (_fn, args) => {
      capturedArgs = args;
      return { data: 0, error: null };
    },
  });
  assert.deepEqual(capturedArgs, { retention_days: 90 });
});

test("parses bare integer RPC response", async () => {
  const result = await runAuditRetentionTick(90, {
    rpc: async () => ({ data: 42, error: null }),
  });
  assert.equal(result.deleted, 42);
});

test("parses one-row single-column table RPC response", async () => {
  const result = await runAuditRetentionTick(90, {
    rpc: async () => ({ data: [{ rgaios_audit_log_prune: 9 }], error: null }),
  });
  assert.equal(result.deleted, 9);
});

test("RPC error returns { deleted: 0, error: message }", async () => {
  const result = await runAuditRetentionTick(90, {
    rpc: async () => ({ data: null, error: { message: "permission denied" } }),
  });
  assert.equal(result.deleted, 0);
  assert.equal(result.error, "permission denied");
});

test("validation: non-integer retention rejected", async () => {
  const result = await runAuditRetentionTick(1.5);
  assert.equal(result.deleted, 0);
  assert.match(result.error ?? "", /must be an integer/);
});

test("validation: zero retention rejected", async () => {
  const result = await runAuditRetentionTick(0);
  assert.equal(result.deleted, 0);
  assert.match(result.error ?? "", /must be > 0/);
});

test("validation: > 3650 days rejected", async () => {
  const result = await runAuditRetentionTick(3651);
  assert.equal(result.deleted, 0);
  assert.match(result.error ?? "", /cannot exceed 3650/);
});

test("validation: negative retention rejected", async () => {
  const result = await runAuditRetentionTick(-5);
  assert.equal(result.deleted, 0);
  assert.match(result.error ?? "", /must be > 0/);
});

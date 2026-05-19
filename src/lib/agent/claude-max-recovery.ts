/**
 * claude-max-recovery.ts - auto-recover Claude Max 401-revoked tokens
 * via DB-stored refresh_token (BUG-44).
 *
 * Why this exists: Marta SDK shells out to the Claude Code CLI, which
 * reads `~/.claude/.credentials.json` for OAuth. Anthropic occasionally
 * revokes access_tokens server-side outside the normal expiry window
 * (live incident 2026-05-19: Pedro hit overnight revocation that left
 * every agent dark until manual /login). The CLI subprocess then fails
 * with "Not logged in" / "Invalid authentication credentials" / 401
 * and no fallback path existed - operator had to interactively re-auth.
 *
 * BUG-44b (A's 2026-05-19 breakthrough): on Marti VPS the Claude Code
 * CLI subprocess does NOT reliably re-read `/home/node/.claude/.credentials.json`
 * once the cached token is revoked - the file path is unreliable as
 * the sole recovery vehicle. A verified via
 * `docker exec -e ANTHROPIC_API_KEY=<refreshed> claude --print` that
 * the CLI DOES honor `ANTHROPIC_API_KEY` directly, returning "PONG"
 * against an otherwise-dark agent. Recovery therefore sets the env
 * var on the parent process so sdk-runner.ts propagates it into every
 * subsequent subprocess via `{ ...process.env }` spread. File write
 * is kept as belt-and-suspenders (helps fresh subprocesses that read
 * the file before any env override).
 *
 * Recovery flow:
 *   1. Read encrypted refresh_token from rgaios_connections.metadata
 *      (claude-max provider row). Cannot recover if missing - operator
 *      must /login interactively to seed a fresh refresh_token.
 *   2. POST grant_type=refresh_token to Anthropic OAuth endpoint via
 *      the existing refreshClaudeMaxAccessToken helper.
 *   3. Write the new access_token into the CLI's credentials.json
 *      (atomic temp+rename, chmod 600). Belt-and-suspenders only -
 *      env var below is the proven recovery path.
 *   4. Set `process.env.ANTHROPIC_API_KEY` so sdk-runner subprocesses
 *      inherit the fresh token (A 2026-05-19: env-var path proven
 *      working; file path unreliable).
 *   5. Persist the new tokens (re-encrypted) back to the DB so the
 *      next recovery cycle has a fresh refresh_token.
 *
 * Callers: chat-sdk.ts try/catch wrapping runAgentSdk. The matcher
 * `looksLikeAuthFail` is exported separately so callers outside this
 * module can detect the failure without owning the recovery path.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabase/server";
import { encryptSecret, tryDecryptSecret } from "@/lib/crypto";
import { refreshClaudeMaxAccessToken } from "./oauth";

const PROVIDER_KEY = "claude-max";

/**
 * Pattern-match the CLI subprocess error to decide whether this is an
 * auth-revoked failure that the recovery path can fix. Matches the
 * three canonical Anthropic / Claude Code wordings plus a literal 401
 * fallback for stderr that carries the HTTP status verbatim.
 */
export function looksLikeAuthFail(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid authentication credentials|not logged in|please run \/login|unauthorized|401/i.test(
    msg,
  );
}

type CredentialsFile = {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
    subscriptionType?: string;
  };
  [key: string]: unknown;
};

function credentialsPath(): string {
  const home =
    process.env.CLAUDE_CLI_HOME ?? process.env.HOME ?? "/home/node";
  return path.join(home, ".claude", ".credentials.json");
}

/**
 * Best-effort atomic rewrite of credentials.json. Reads current file
 * (empty object if missing), mutates only the OAuth fields we own,
 * writes to a `.tmp` sibling, then renames. Mode 0600 to match the
 * security posture of the file the CLI seeds on initial login.
 */
async function rewriteCredentialsFile(
  accessToken: string,
  refreshToken: string | undefined,
  expiresInSec: number | undefined,
): Promise<void> {
  const filePath = credentialsPath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  let current: CredentialsFile = {};
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    current = JSON.parse(raw) as CredentialsFile;
  } catch {
    // Missing or malformed - start from empty. The CLI will accept any
    // object that has claudeAiOauth.accessToken set.
  }

  const existing = current.claudeAiOauth ?? {};
  const expiresAt =
    typeof expiresInSec === "number" && expiresInSec > 0
      ? Date.now() + expiresInSec * 1000
      : (existing.expiresAt ?? Date.now() + 8 * 3600 * 1000);

  current.claudeAiOauth = {
    ...existing,
    accessToken,
    refreshToken: refreshToken ?? existing.refreshToken ?? "",
    expiresAt,
    scopes: existing.scopes ?? ["user:inference", "user:profile"],
    subscriptionType: existing.subscriptionType ?? "max",
  };

  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(current, null, 2), { mode: 0o600 });
  await fs.rename(tmp, filePath);
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // chmod failure is non-fatal - rename preserved the temp mode.
  }
}

/**
 * Attempt to recover a revoked Claude Max OAuth token for the given
 * organization. On success the CLI's credentials.json carries a fresh
 * access_token and the DB row carries the rotated refresh_token.
 *
 * Returns `{ok: true}` on success; otherwise `{ok: false, reason}` with
 * an operator-readable explanation. Never throws - the caller decides
 * how to surface the failure (chat-sdk re-throws with a wrapped msg).
 */
export async function recoverClaudeMaxAuth(
  organizationId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("rgaios_connections")
    .select("id, metadata")
    .eq("organization_id", organizationId)
    .eq("provider_config_key", PROVIDER_KEY)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: `DB lookup failed: ${error.message}` };
  }
  if (!data) {
    return {
      ok: false,
      reason: `no claude-max row for org ${organizationId}; Pedro must /login interactively`,
    };
  }

  const meta = (data.metadata ?? {}) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | null;
    [k: string]: unknown;
  };

  const refreshToken = tryDecryptSecret(meta.refresh_token);
  if (!refreshToken) {
    return {
      ok: false,
      reason: "no refresh_token in DB; Pedro must /login interactively",
    };
  }

  const refreshed = await refreshClaudeMaxAccessToken(refreshToken);
  if (!refreshed.ok) {
    return {
      ok: false,
      reason: `OAuth refresh failed${
        refreshed.status ? ` (status ${refreshed.status})` : ""
      }: ${refreshed.error}`,
    };
  }

  try {
    await rewriteCredentialsFile(
      refreshed.access_token,
      refreshed.refresh_token,
      refreshed.expires_in,
    );
  } catch (writeErr) {
    return {
      ok: false,
      reason: `credentials.json rewrite failed: ${(writeErr as Error).message}`,
    };
  }

  // BUG-44b (A 2026-05-19): file write alone is unreliable - the CLI
  // subprocess may keep a cached/revoked token in memory and ignore
  // the rewritten file. ANTHROPIC_API_KEY in the parent process env
  // is the proven recovery vehicle: sdk-runner.ts spreads
  // `...process.env` into the subprocess env block so every spawn
  // after this point inherits the fresh access_token directly.
  process.env.ANTHROPIC_API_KEY = refreshed.access_token;

  const nextMeta = {
    ...meta,
    access_token: encryptSecret(refreshed.access_token),
    refresh_token: refreshed.refresh_token
      ? encryptSecret(refreshed.refresh_token)
      : (meta.refresh_token ?? ""),
    expires_in: refreshed.expires_in ?? meta.expires_in ?? null,
    refreshed_at: new Date().toISOString(),
  };

  const { error: updateErr } = await db
    .from("rgaios_connections")
    .update({ metadata: nextMeta } as never)
    .eq("id", data.id);
  if (updateErr) {
    // Credentials.json already rewritten so the immediate retry will
    // succeed; DB drift will be reconciled on the next recovery cycle.
    console.warn(
      `[claude-max-recovery] DB update failed (creds.json already rotated): ${updateErr.message}`,
    );
  }

  return { ok: true };
}

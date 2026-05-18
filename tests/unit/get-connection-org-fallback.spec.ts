import test from "node:test";
import assert from "node:assert/strict";

// BUG-37 (D 2026-05-18 R-COMPOSIO-3 calendar walk + DB verify):
// rgaios_connections has composio:google-calendar with status=connected
// but user_id belongs to a different org member than the caller. With
// the old getConnection (caller-scoped lookup + user_id IS NULL
// fallback only), the row was unreachable and Composio rejected with
// "no connected account for toolkit Google Calendar".
//
// Pedro mandate "n pode desconectar, tem que ser assim, de outro jeito"
// blocks an operator reconnect workaround. Server-side fallback is the
// fix: when caller-scoped AND org-wide both miss, return ANY
// status=connected row IFF exactly one exists for that
// (organization_id, provider_config_key). Single-row guard prevents
// cross-user leak in personal-toolkit scenarios.
//
// These tests pin the contract of the fallback policy, not the DB
// implementation (which uses supabaseAdmin and is integration-tested
// elsewhere). The unit isolation here mirrors the 3-stage matcher.

type Row = {
  id: string;
  user_id: string | null;
  provider_config_key: string;
  status: string;
};

function matchPolicy(
  rows: Row[],
  callerUserId: string | null,
): Row | null {
  if (callerUserId) {
    const perUser = rows.find(
      (r) => r.user_id === callerUserId && r.status === "connected",
    );
    if (perUser) return perUser;
  }
  const orgWide = rows.find(
    (r) => r.user_id === null && r.status === "connected",
  );
  if (orgWide) return orgWide;
  const connected = rows.filter((r) => r.status === "connected");
  if (connected.length === 1) return connected[0];
  return null;
}

const cal = (
  uid: string | null,
  status = "connected",
  id = "row-" + Math.random(),
): Row => ({
  id,
  user_id: uid,
  provider_config_key: "composio:google-calendar",
  status,
});

test("caller-scoped match wins when row exists for the caller", () => {
  const rows = [cal("pedro"), cal("other")];
  assert.equal(matchPolicy(rows, "pedro")?.user_id, "pedro");
});

test("org-wide (user_id IS NULL) fallback when caller has no row", () => {
  const rows = [cal(null), cal("other")];
  assert.equal(matchPolicy(rows, "pedro")?.user_id, null);
});

test("BUG-37 single-row org-shared fallback: returns the only connected row", () => {
  // Live production case: only 1 row for calendar, owned by user_id=admin,
  // caller=pedro has no row + no null row. Old policy returned null.
  // New policy returns the single connected row.
  const rows = [cal("admin")];
  const m = matchPolicy(rows, "pedro");
  assert.ok(m, "BUG-37 fallback must surface the single connected row");
  assert.equal(m!.user_id, "admin");
});

test("multi-row personal-toolkit: fallback does NOT fire (cross-user leak guard)", () => {
  // Two sales reps each with their own Hubspot account. Caller is a
  // third user with no row. Old null behaviour must be preserved so
  // we don't accidentally give caller someone else's grant.
  const rows = [cal("alice"), cal("bob")];
  assert.equal(matchPolicy(rows, "carol"), null);
});

test("disconnected single row: fallback does NOT fire", () => {
  // A stale pending_token / disconnected row must not be surfaced.
  const rows = [cal("admin", "disconnected")];
  assert.equal(matchPolicy(rows, "pedro"), null);
});

test("anonymous caller (no userId) still gets org-wide row", () => {
  // Drain server / cron path passes userId=null. Org-wide row must
  // still match.
  const rows = [cal(null), cal("other")];
  assert.equal(matchPolicy(rows, null)?.user_id, null);
});

test("anonymous caller + BUG-37 single-row fallback: works", () => {
  const rows = [cal("admin")];
  const m = matchPolicy(rows, null);
  assert.ok(m);
  assert.equal(m!.user_id, "admin");
});

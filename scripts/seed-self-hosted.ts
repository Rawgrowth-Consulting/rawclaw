/* eslint-disable no-console */
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

/**
 * One-shot seed for a fresh self-hosted instance.
 *
 *   • If an org already exists, do nothing — this is safe on every boot.
 *   • Otherwise create one org + one owner user + mint an MCP token,
 *     using SEED_* env vars. Print the MCP token once at the end so the
 *     operator can paste it into Claude Code.
 */

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[seed] DATABASE_URL is required");
    process.exit(1);
  }

  const orgName = process.env.SEED_ORG_NAME ?? "Local Dev";
  const orgSlug = process.env.SEED_ORG_SLUG ?? "local-dev";
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@local").toLowerCase();
  const adminName = process.env.SEED_ADMIN_NAME ?? "Admin";

  // If the operator didn't supply a password, generate a strong one and
  // print it with the credentials banner — they only need to capture it once.
  let adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "";
  let generatedPassword = false;
  if (!adminPassword) {
    adminPassword = randomBytes(12).toString("base64url");
    generatedPassword = true;
  }
  if (adminPassword.length < 8) {
    console.error("[seed] SEED_ADMIN_PASSWORD must be ≥ 8 chars");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  // Step 1: find or create an org. If one exists (e.g. a migration seeded
  // a "default" org), adopt it. Otherwise create one from SEED_* env.
  const { rows: existing } = await client.query<{
    id: string;
    name: string;
    slug: string;
    mcp_token: string | null;
  }>(
    `select id, name, slug, mcp_token from rgaios_organizations
     order by created_at asc limit 1`,
  );

  let orgId: string;
  let orgDisplay: { name: string; slug: string };

  if (existing[0]) {
    orgId = existing[0].id;
    orgDisplay = { name: existing[0].name, slug: existing[0].slug };
  } else {
    const { rows: created } = await client.query<{
      id: string;
      name: string;
      slug: string;
    }>(
      `insert into rgaios_organizations (name, slug)
       values ($1, $2)
       returning id, name, slug`,
      [orgName, orgSlug],
    );
    orgId = created[0]!.id;
    orgDisplay = { name: created[0]!.name, slug: created[0]!.slug };
  }

  // Step 2: ensure the org has an MCP token. Only mint one if missing so
  // re-runs don't invalidate the token the operator already handed out.
  let mcpToken = existing[0]?.mcp_token ?? null;
  if (!mcpToken) {
    mcpToken = `rgmcp_${randomBytes(24).toString("hex")}`;
    await client.query(
      `update rgaios_organizations set mcp_token = $1 where id = $2`,
      [mcpToken, orgId],
    );
  }

  // Step 3: ensure the admin user exists and is attached to this org.
  // Upsert by email — tolerates a pre-existing user row from a prior attempt.
  const { rows: userCheck } = await client.query<{ password_hash: string | null }>(
    `select password_hash from rgaios_users where email = $1`,
    [adminEmail],
  );

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  if (userCheck[0]) {
    // Existing user: re-tie to this org + set password only if one was explicitly provided.
    if (generatedPassword) {
      // Don't clobber a known password with a random one on re-runs.
      console.log(
        `[seed] admin user ${adminEmail} already exists — leaving password unchanged`,
      );
      await client.query(
        `update rgaios_users set organization_id = $1, role = 'owner' where email = $2`,
        [orgId, adminEmail],
      );
    } else {
      await client.query(
        `update rgaios_users set password_hash = $1, organization_id = $2, role = 'owner' where email = $3`,
        [passwordHash, orgId, adminEmail],
      );
    }
  } else {
    await client.query(
      `insert into rgaios_users (email, name, password_hash, organization_id, role, email_verified)
       values ($1, $2, $3, $4, 'owner', now())`,
      [adminEmail, adminName, passwordHash, orgId],
    );
  }

  const isFirstBoot = !userCheck[0] && !existing[0]?.mcp_token;

  console.log("");
  console.log("──────────────────────────────────────────────────────────");
  console.log(
    isFirstBoot
      ? "[seed] First-boot bootstrap complete"
      : "[seed] Bootstrap verified (idempotent — no changes)",
  );
  console.log("──────────────────────────────────────────────────────────");
  console.log(`  Organization:  ${orgDisplay.name} (${orgDisplay.slug})`);
  console.log(`  Admin email:   ${adminEmail}`);
  if (isFirstBoot && generatedPassword) {
    console.log(`  Admin password (generated — save this!):`);
    console.log(`    ${adminPassword}`);
  } else if (isFirstBoot) {
    console.log(`  Admin password: (from SEED_ADMIN_PASSWORD env)`);
  } else {
    console.log(`  Admin password: unchanged — use the one you already have`);
  }
  console.log(`  Admin role:    owner`);
  console.log("");
  console.log("  MCP token (paste into Claude Code config):");
  console.log(`    ${mcpToken}`);
  console.log("");
  console.log("  See CLAUDE_CODE_SETUP.md for the exact MCP config.");
  console.log("──────────────────────────────────────────────────────────");
  console.log("");

  await client.end();
}

main().catch((err) => {
  console.error("[seed] fatal:", err);
  process.exit(1);
});

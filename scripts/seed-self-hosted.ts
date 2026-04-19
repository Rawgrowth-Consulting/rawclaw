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

  const { rows: orgs } = await client.query<{ count: string }>(
    `select count(*)::text as count from rgaios_organizations`,
  );
  if (Number(orgs[0]?.count ?? 0) > 0) {
    console.log("[seed] organizations already exist — skipping");
    await client.end();
    return;
  }

  const mcpToken = `rgmcp_${randomBytes(24).toString("hex")}`;

  const { rows: orgRows } = await client.query<{ id: string }>(
    `insert into rgaios_organizations (name, slug, mcp_token)
     values ($1, $2, $3)
     returning id`,
    [orgName, orgSlug, mcpToken],
  );
  const orgId = orgRows[0]!.id;

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await client.query(
    `insert into rgaios_users (email, name, password_hash, organization_id, role, email_verified)
     values ($1, $2, $3, $4, 'owner', now())`,
    [adminEmail.toLowerCase(), adminName, passwordHash, orgId],
  );

  console.log("");
  console.log("──────────────────────────────────────────────────────────");
  console.log("[seed] First-boot bootstrap complete");
  console.log("──────────────────────────────────────────────────────────");
  console.log(`  Organization:  ${orgName} (${orgSlug})`);
  console.log(`  Admin email:   ${adminEmail}`);
  if (generatedPassword) {
    console.log(`  Admin password (generated — save this!):`);
    console.log(`    ${adminPassword}`);
  } else {
    console.log(`  Admin password: (from SEED_ADMIN_PASSWORD env)`);
  }
  console.log(`  Admin role:    owner`);
  console.log("");
  console.log("  MCP token (paste into Claude Code config):");
  console.log(`    ${mcpToken}`);
  console.log("");
  console.log("  Sign in:       http://localhost/auth/signin");
  console.log("  See CLAUDE_CODE_SETUP.md for the exact MCP config.");
  console.log("──────────────────────────────────────────────────────────");
  console.log("");

  await client.end();
}

main().catch((err) => {
  console.error("[seed] fatal:", err);
  process.exit(1);
});

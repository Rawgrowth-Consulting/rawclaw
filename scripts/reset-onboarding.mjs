// Reset onboarding state for pedro@local's org so /onboarding starts
// from zero. Pedro authorized: option 3 of 3 from the chat.
// Wipes: brand_profiles, brand_intakes, intake-related sections,
// resets onboarding_step + onboarding_completed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const here = new URL(".", import.meta.url).pathname;
const repo = resolve(here, "..");
const env = readFileSync(resolve(repo, ".env"), "utf8")
  .split(/\r?\n/).filter((l) => l && !l.startsWith("#"))
  .reduce((m, l) => { const i = l.indexOf("="); if (i > 0) m[l.slice(0, i)] = l.slice(i + 1); return m; }, {});

const url = env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }

const client = new pg.Client({ connectionString: url });
await client.connect();
console.log(`[reset] connected to ${url.replace(/:[^:@]+@/, ":***@")}`);

// Find pedro@local's home org
const u = await client.query(
  `select id, email, home_org_id from rgaios_users where email = $1 limit 1`,
  ["pedro@local"],
);
if (u.rows.length === 0) { console.error("[reset] user pedro@local not found"); process.exit(1); }
const orgId = u.rows[0].home_org_id;
console.log(`[reset] pedro@local home_org_id = ${orgId}`);

const o = await client.query(
  `select id, name, slug, onboarding_step, onboarding_completed
   from rgaios_organizations where id = $1 limit 1`,
  [orgId],
);
if (o.rows.length === 0) { console.error("[reset] org not found"); process.exit(1); }
console.log(`[reset] org before:`, o.rows[0]);

await client.query("begin");
try {
  // Wipe brand profiles + intakes (versioned). Keep agents, routines etc.
  const bp = await client.query(
    `delete from rgaios_brand_profiles where organization_id = $1 returning id`,
    [orgId],
  );
  console.log(`[reset] deleted ${bp.rowCount} brand_profile row(s)`);

  // brand_intakes table might or might not exist - try and ignore.
  try {
    const bi = await client.query(
      `delete from rgaios_brand_intakes where organization_id = $1 returning id`,
      [orgId],
    );
    console.log(`[reset] deleted ${bi.rowCount} brand_intake row(s)`);
  } catch (e) {
    console.log(`[reset] (no rgaios_brand_intakes table or other reason: ${e.message})`);
  }

  // onboarding_documents (D2 port)
  try {
    const od = await client.query(
      `delete from rgaios_onboarding_documents where organization_id = $1 returning id`,
      [orgId],
    );
    console.log(`[reset] deleted ${od.rowCount} onboarding_document row(s)`);
  } catch (e) {
    console.log(`[reset] (no rgaios_onboarding_documents: ${e.message})`);
  }

  // Reset org's onboarding flags + clear intake jsonb columns if present.
  const updateRes = await client.query(
    `update rgaios_organizations
       set onboarding_step = 0,
           onboarding_completed = false,
           messaging_channel = null,
           messaging_handle = null,
           slack_workspace_url = null,
           slack_channel_name = null,
           updated_at = now()
     where id = $1
     returning onboarding_step, onboarding_completed`,
    [orgId],
  );
  console.log(`[reset] org after:`, updateRes.rows[0]);

  await client.query("commit");
  console.log("[reset] committed");
} catch (err) {
  await client.query("rollback");
  console.error("[reset] failed, rolled back:", err.message);
  process.exit(1);
}

await client.end();
console.log("[reset] done. /onboarding will start fresh on next visit.");

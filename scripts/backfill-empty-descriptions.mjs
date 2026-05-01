// Backfill agent.description from the first sentence of system_prompt
// when description is null or empty. Idempotent.
import "dotenv/config";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }

const c = new pg.Client({ connectionString: url });
await c.connect();

const { rows } = await c.query(`
  select id, name, system_prompt
  from rgaios_agents
  where (description is null or trim(description) = '')
    and system_prompt is not null
    and trim(system_prompt) <> ''
`);

let updated = 0;
for (const r of rows) {
  const m = r.system_prompt.match(/^([^.!?]+[.!?])/);
  const first = m?.[1]?.trim();
  if (!first || first.length > 280) continue;
  await c.query(
    `update rgaios_agents set description = $1 where id = $2`,
    [first, r.id],
  );
  console.log(`  ${r.name}: ${first.slice(0, 80)}...`);
  updated += 1;
}
console.log(`backfilled ${updated} agents`);
await c.end();

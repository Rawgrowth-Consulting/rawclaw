import "dotenv/config";
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows } = await c.query(`
  select c.organization_id, o.slug, c.provider_config_key, c.status, c.display_name, c.connected_at
  from rgaios_connections c
  join rgaios_organizations o on o.id = c.organization_id
  where c.provider_config_key = 'claude-max'
  order by c.connected_at desc
`);
for (const r of rows) console.log(`${r.slug}: ${r.status} ${r.display_name ?? ''} (${r.connected_at})`);
console.log(`total: ${rows.length}`);
await c.end();

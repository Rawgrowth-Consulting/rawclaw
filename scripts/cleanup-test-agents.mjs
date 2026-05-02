// Delete the test Copywriter so Acme org is clean for demo screenshots
import "dotenv/config";
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows } = await c.query(`
  delete from rgaios_agents
   where name like 'Copywriter-%'
     and organization_id = (select id from rgaios_organizations where slug = 'acme-coaching-76897')
  returning id, name
`);
for (const r of rows) console.log(`deleted ${r.name} (${r.id})`);
console.log(`total: ${rows.length}`);
await c.end();

import "dotenv/config";
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
// Test the archive filter query
const { rows } = await c.query(`
  select count(*) as visible from rgaios_agent_chat_messages
  where organization_id = (select id from rgaios_organizations where slug='acme-coaching-76897')
    and (metadata->>'archived' is null or metadata->>'archived' = 'false')
`);
console.log("visible (non-archived):", rows[0].visible);
const { rows: archived } = await c.query(`
  select count(*) as archived from rgaios_agent_chat_messages
  where organization_id = (select id from rgaios_organizations where slug='acme-coaching-76897')
    and metadata->>'archived' = 'true'
`);
console.log("archived:", archived[0].archived);
await c.end();

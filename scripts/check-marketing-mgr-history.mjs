import "dotenv/config";
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows } = await c.query(`
  select role, substring(content, 1, 80) as preview, created_at
  from rgaios_agent_chat_messages
  where organization_id = (select id from rgaios_organizations where slug = 'acme-coaching-76897')
    and agent_id = (select id from rgaios_agents where organization_id = (select id from rgaios_organizations where slug = 'acme-coaching-76897') and is_department_head = true and department = 'marketing')
  order by created_at desc limit 20
`);
console.log(`messages: ${rows.length}`);
for (const r of rows) console.log(`  [${r.role}] ${r.preview}`);

const { rows: mem } = await c.query(`
  select substring(detail->>'fact', 1, 100) as fact, ts
  from rgaios_audit_log
  where organization_id = (select id from rgaios_organizations where slug = 'acme-coaching-76897')
    and kind = 'chat_memory'
    and detail->>'agent_id' = (select id::text from rgaios_agents where organization_id = (select id from rgaios_organizations where slug = 'acme-coaching-76897') and is_department_head = true and department = 'marketing')
  order by ts desc limit 10
`);
console.log(`\nmemories: ${mem.length}`);
for (const r of mem) console.log(`  ${r.fact}`);
await c.end();

// One-shot backfill: walk every org's rgaios_agents rows and infer
// the missing `department` slug + `is_department_head` flag from the
// agent's name/title. Idempotent - re-running is a no-op for any agent
// already correctly tagged.
//
// Why this exists: orgs created BEFORE the seedDefaultAgentsForOrg
// landing in src/lib/agents/seed.ts have 13 default agents sitting in
// the Unassigned bucket on /departments and tagged UNASSIGNED on
// /agents/tree. New orgs are fixed at provisioning time. This script
// is the one-time sweep for the existing rawclawv3 org. Pedro will
// authorize when to actually run it.
//
// Usage: node scripts/backfill-agent-departments.mjs
//
// Reads DATABASE_URL from .env (same pattern as apply-cloud-migrations.mjs).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const here = new URL(".", import.meta.url).pathname;
const repo = resolve(here, "..");
const env = readFileSync(resolve(repo, ".env"), "utf8")
  .split(/\r?\n/)
  .filter((l) => l && !l.startsWith("#"))
  .reduce((m, l) => {
    const i = l.indexOf("=");
    if (i > 0) m[l.slice(0, i)] = l.slice(i + 1);
    return m;
  }, {});

const url = env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing in .env");
  process.exit(1);
}

// Manager name -> department slug mapping. Matches the seed in
// src/lib/agents/seed.ts so a backfilled org ends up with the same
// shape as a freshly seeded one.
//
// Order matters: the FIRST keyword to match the agent's name (case-
// insensitive) wins. Put the most specific keywords first so e.g.
// "Marketing Operations Manager" lands in marketing, not fulfilment.
const MANAGER_KEYWORDS = [
  { keyword: "marketing", department: "marketing" },
  { keyword: "sales", department: "sales" },
  { keyword: "engineering", department: "development" },
  { keyword: "engineer", department: "development" },
  { keyword: "developer", department: "development" },
  { keyword: "development", department: "development" },
  { keyword: "operations", department: "fulfilment" },
  { keyword: "fulfilment", department: "fulfilment" },
  { keyword: "fulfillment", department: "fulfilment" },
  { keyword: "ops", department: "fulfilment" },
  { keyword: "finance", department: "finance" },
  { keyword: "bookkeep", department: "finance" },
  { keyword: "accountant", department: "finance" },
  { keyword: "content", department: "marketing" },
  { keyword: "social", department: "marketing" },
  { keyword: "sdr", department: "sales" },
  { keyword: "qa", department: "development" },
  { keyword: "backend", department: "development" },
  { keyword: "frontend", department: "development" },
];

function inferDepartment(agent) {
  const haystack = `${agent.name ?? ""} ${agent.title ?? ""}`.toLowerCase();
  for (const { keyword, department } of MANAGER_KEYWORDS) {
    if (haystack.includes(keyword)) return department;
  }
  return null;
}

function isManagerName(agent) {
  const haystack = `${agent.name ?? ""} ${agent.title ?? ""}`.toLowerCase();
  return /\bmanager\b|\bhead of\b|\blead\b/.test(haystack);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
console.log("[backfill] connected to", url.replace(/:[^:@]+@/, ":***@"));

const { rows: orgs } = await client.query(
  `select id, slug from rgaios_organizations order by created_at asc`,
);
console.log(`[backfill] scanning ${orgs.length} orgs`);

let totals = { agents: 0, deptUpdated: 0, headPromoted: 0, alreadyOk: 0 };

for (const org of orgs) {
  const { rows: agents } = await client.query(
    `select id, name, title, role, reports_to, department, is_department_head
       from rgaios_agents
      where organization_id = $1
      order by created_at asc`,
    [org.id],
  );
  totals.agents += agents.length;

  // Pass 1: walk every agent, infer department from name/title. Update
  // only when (a) department is null OR (b) the inferred slug differs
  // AND the agent has no reports_to (we trust an existing parent chain
  // over keyword-matching).
  for (const a of agents) {
    const inferred = inferDepartment(a);
    if (!inferred) continue;

    const needsDeptUpdate = a.department === null;
    if (!needsDeptUpdate) {
      totals.alreadyOk += 1;
      continue;
    }

    const looksLikeManager = isManagerName(a) && a.reports_to === null;

    // Idempotency guard for the head flag: if a head already exists
    // for (org, dept), don't promote a second one - the partial unique
    // index would reject the update anyway. Skip the head flag in that
    // case, just write the department.
    let promoteToHead = false;
    if (looksLikeManager) {
      const { rows: existingHead } = await client.query(
        `select id from rgaios_agents
          where organization_id = $1
            and department = $2
            and is_department_head = true
          limit 1`,
        [org.id, inferred],
      );
      if (existingHead.length === 0) promoteToHead = true;
    }

    const updates = ["department = $3"];
    const params = [a.id, org.id, inferred];
    if (promoteToHead) {
      updates.push("is_department_head = true");
    }
    const sql = `update rgaios_agents
                    set ${updates.join(", ")}
                  where id = $1
                    and organization_id = $2
                    and department is null`;
    const { rowCount } = await client.query(sql, params);
    if (rowCount > 0) {
      totals.deptUpdated += 1;
      if (promoteToHead) totals.headPromoted += 1;
    }
  }

  // Pass 2: any agent whose reports_to points at a head with a known
  // department but whose own department is still null gets the parent's
  // slug. Catches sub-agents whose names don't match a keyword (e.g.
  // "Atlas" reporting to "Marketing Manager").
  const { rows: orphans } = await client.query(
    `select c.id as child_id, p.department as parent_department
       from rgaios_agents c
       join rgaios_agents p on p.id = c.reports_to
      where c.organization_id = $1
        and c.department is null
        and p.department is not null`,
    [org.id],
  );
  for (const o of orphans) {
    const { rowCount } = await client.query(
      `update rgaios_agents
          set department = $2
        where id = $1
          and department is null`,
      [o.child_id, o.parent_department],
    );
    if (rowCount > 0) totals.deptUpdated += 1;
  }

  console.log(
    `[backfill] org ${org.slug}: ${agents.length} agents scanned`,
  );
}

console.log("");
console.log("[backfill] done");
console.log(`  agents scanned:        ${totals.agents}`);
console.log(`  department written:    ${totals.deptUpdated}`);
console.log(`  promoted to head:      ${totals.headPromoted}`);
console.log(`  already had a slug:    ${totals.alreadyOk}`);

await client.end();

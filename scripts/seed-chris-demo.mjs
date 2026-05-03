// Pre-seed Chris West demo workspace on the production Supabase Cloud
// so Chris can log in + see a populated dashboard without running the
// onboarding chat (which needs OPENAI_API_KEY we don't have on this
// deploy). Idempotent.
//
// Pipeline:
//   1. Create org "Chris West Demo" + owner user with known temp pw
//   2. Seed default 14 agents (Atlas + 5 dept heads + 8 sub-agents)
//      via existing seedDefaultAgentsForOrg
//   3. Insert approved brand profile (Rawclaw fictional brand)
//   4. Mirror brand into company_chunks for RAG
//   5. Insert 2 demo tasks (one with succeeded run + output) so the
//      Tasks page + Activity feed are populated on first load
//   6. Mark org onboarding_completed=true so dashboard gate doesn't
//      bounce him to /onboarding
//
// Outputs creds at the end so Pedro can hand them to Chris.

import "dotenv/config";
import pg from "pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const orgName = "Chris West Demo";
const orgSlug = "chris-west-demo";
const ownerEmail = "chris@rawclaw.demo";
const ownerName = "Chris West";
const tempPassword = "rawclaw-demo-2026";
const passwordHash = await bcrypt.hash(tempPassword, 12);

// 1. Org
let orgId;
const { rows: existingOrg } = await c.query(
  `select id from rgaios_organizations where slug = $1`,
  [orgSlug],
);
if (existingOrg.length > 0) {
  orgId = existingOrg[0].id;
  console.log(`org exists: ${orgId.slice(0, 8)}`);
} else {
  orgId = randomUUID();
  await c.query(
    `insert into rgaios_organizations
       (id, name, slug, mcp_token, marketing, sales, fulfilment, finance,
        onboarding_completed, onboarding_step, created_at, updated_at)
     values
       ($1, $2, $3, $4, true, true, true, true, true, 8, now(), now())`,
    [
      orgId,
      orgName,
      orgSlug,
      "rgmcp_" + randomUUID().replace(/-/g, ""),
    ],
  );
  console.log(`✓ created org ${orgId.slice(0, 8)}`);
}

// 2. Owner user
const { rows: existingUser } = await c.query(
  `select id from rgaios_users where email = $1`,
  [ownerEmail],
);
if (existingUser.length > 0) {
  await c.query(
    `update rgaios_users set password_hash = $1, organization_id = $2, name = $3 where email = $4`,
    [passwordHash, orgId, ownerName, ownerEmail],
  );
  console.log(`✓ reset password for ${ownerEmail}`);
} else {
  await c.query(
    `insert into rgaios_users (email, name, password_hash, organization_id) values ($1, $2, $3, $4)`,
    [ownerEmail, ownerName, passwordHash, orgId],
  );
  console.log(`✓ created user ${ownerEmail}`);
}

// 3. Brand profile
const brandMd = `# Rawclaw - Brand Profile

## What we sell
The AI-native operating system for service businesses doing $3M-$15M/yr. Per-client AI org chart with CEO Atlas + dept managers (Marketing, Sales, Fulfilment, Finance, Ops) plus sub-agents, all wired to your tools + company DB.

## Who it's for
Founders running coaching, consulting, agency, life-insurance, sales-agency businesses with 15-50 employees. They're allergic to fluff, want results without thinking, and have the budget to pay for the result not the process.

## Voice & tone
Operator-grade. Short sentences. Concrete verbs. Numbers beat adjectives. Direct, no fluff. We never say leverage / synergy / unlock / utilize / deep dive / streamline / empower / certainly / cutting-edge / revolutionary / game-changer.

## Frameworks the agents use
- Marketing: AIDA, PAS, hook tear-downs, Eugene Schwartz awareness stages
- Sales: 8-step SDR cadence, MEDDPICC, objection bank
- Fulfilment: weekly OKR, project status RAG, retention check-in cadence
- Finance: weekly MRR pull, CAC payback math, cohort LTV, runway

## Pricing tiers
Founder ($2k/mo), Growth ($6k/mo), Scale ($15k/mo). Annual discount 15%.
`;

const { rows: existingBrand } = await c.query(
  `select id from rgaios_brand_profiles where organization_id = $1 and status = 'approved' limit 1`,
  [orgId],
);
let brandId;
if (existingBrand.length > 0) {
  brandId = existingBrand[0].id;
  console.log(`brand exists: ${brandId.slice(0, 8)}`);
} else {
  const now = Date.now();
  const { rows } = await c.query(
    `insert into rgaios_brand_profiles
       (organization_id, version, content, status, generated_at, approved_at, approved_by)
     values ($1, 1, $2, 'approved', $3, $3, 'seed-script')
     returning id`,
    [orgId, brandMd, now],
  );
  brandId = rows[0].id;
  console.log(`✓ inserted brand v1 (${brandMd.length} chars)`);
}

// 4. Mirror brand → company_chunks (split by H2)
const { rows: chunkCount } = await c.query(
  `select count(*) from rgaios_company_chunks where organization_id = $1 and source = 'brand_profile'`,
  [orgId],
);
if (Number(chunkCount[0].count) === 0) {
  // Use 1536d zero vector as embedding - real RAG retrieval needs
  // fastembed which isn't on Vercel; chunks still appear in
  // company_query keyword passthrough.
  const sections = brandMd.split(/\n(?=## )/g).filter((s) => s.trim());
  for (let i = 0; i < sections.length; i++) {
    const text = sections[i].trim();
    if (text.length < 30) continue;
    const vec = `[${new Array(1536).fill(0).join(",")}]`;
    await c.query(
      `insert into rgaios_company_chunks
         (organization_id, source, source_id, chunk_index, content, embedding, metadata)
       values ($1, 'brand_profile', $2, $3, $4, $5::vector, $6)`,
      [orgId, brandId, i, text, vec, JSON.stringify({ kind: "brand_section" })],
    );
  }
  console.log(`✓ inserted ${sections.length} brand chunks`);
}

// 5. Seed agents - reuse the application's seed function via the
// rgaios_seed_default_agents RPC if exists; fallback to direct inserts.
const { rows: existingAgents } = await c.query(
  `select count(*) from rgaios_agents where organization_id = $1`,
  [orgId],
);
if (Number(existingAgents[0].count) === 0) {
  // Minimal agent set: Atlas + 5 dept heads. Sub-agents skipped to
  // keep seed fast; user can hire more from /agents.
  const agentSeeds = [
    { name: "Atlas", role: "ceo", title: "Chief AI Coordinator", department: null, isHead: false, sp: "You are the company-wide AI coordinator. Route requests to the right department head, summarize cross-department status, escalate to the human owner only when the answer needs decisions outside our running policies." },
    { name: "Marketing Manager", role: "marketer", title: "Head of Marketing", department: "marketing", isHead: true, sp: "You are the head of marketing. You own the funnel from cold reach to qualified lead. Direct, operator-grade voice. Use AIDA/PAS frameworks. Coordinate Content Strategist + Social Media Manager when needed." },
    { name: "Sales Manager", role: "sdr", title: "Head of Sales", department: "sales", isHead: true, sp: "You are the head of sales. You own pipeline conversion lead → won. 8-step SDR cadence + MEDDPICC qualification. Always concrete next-step focused." },
    { name: "Operations Manager", role: "ops", title: "Head of Operations", department: "fulfilment", isHead: true, sp: "You are the head of ops. Weekly OKR roll-up, project-status RAG (red/amber/green), client retention cadence. Numbers over adjectives." },
    { name: "Finance Manager", role: "general", title: "Head of Finance", department: "finance", isHead: true, sp: "You are the head of finance. Weekly MRR pull, CAC payback, cohort LTV, runway. Direct numerical reporting. Flag anomalies fast." },
    { name: "Engineering Manager", role: "cto", title: "Head of Engineering", department: "development", isHead: true, sp: "You are the head of engineering. Sprint planning, code-quality gates, deploy safety. Build mini-SaaS apps when asked via the Mini SaaS page." },
  ];
  let atlasId = null;
  for (const a of agentSeeds) {
    const id = randomUUID();
    if (a.role === "ceo") atlasId = id;
    await c.query(
      `insert into rgaios_agents
         (id, organization_id, name, role, title, description, system_prompt,
          department, is_department_head, runtime, status, reports_to, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'claude-sonnet-4-6', 'idle', $10, now(), now())`,
      [id, orgId, a.name, a.role, a.title, a.sp.split(".")[0], a.sp, a.department, a.isHead, a.role === "ceo" ? null : atlasId],
    );
  }
  console.log(`✓ seeded ${agentSeeds.length} agents`);
}

// 6. Demo tasks (1 succeeded with output, 1 pending)
const { rows: existingTasks } = await c.query(
  `select count(*) from rgaios_routines where organization_id = $1 and title ilike 'Welcome demo%'`,
  [orgId],
);
if (Number(existingTasks[0].count) === 0) {
  const { rows: marketer } = await c.query(
    `select id from rgaios_agents where organization_id=$1 and role='marketer' and is_department_head=true limit 1`,
    [orgId],
  );
  const marketerId = marketer[0]?.id;
  if (marketerId) {
    // Succeeded task with sample output
    const { rows: routine1 } = await c.query(
      `insert into rgaios_routines (organization_id, title, description, assignee_agent_id, status, created_at, updated_at)
       values ($1, 'Welcome demo: 3 LinkedIn hooks for Founder tier', $2, $3, 'active', now() - interval '2 hours', now() - interval '2 hours')
       returning id`,
      [
        orgId,
        "Draft 3 LinkedIn hooks for the $2k/mo Founder tier. Target solo founders 0-3 employees just past first hire.",
        marketerId,
      ],
    );
    const sampleOutput = `**3 LinkedIn Hooks - $2k/mo Founder Tier**

**Hook 1 - PAS**
*You hired a VA. She lasted 11 days.*
Now you're back to managing your own calendar, your own DMs, your own Loom intake. You burned $1,800 to learn what most founders learn the hard way: a $20/hr human can't replace your $200/hr judgment.
Rawclaw's Founder tier is $2k/mo. CEO agent + 5 dept managers. Trained on you. Doesn't quit.

*Image direction*: Founder at desk, clock at 11pm, half-finished Loom on screen.

**Hook 2 - AIDA**
*Attention*: Your "AI workflow" is 14 Zapier zaps held together with prayer.
*Interest*: Rawclaw replaces those 14 zaps with one CEO agent + 5 dept managers.
*Desire*: Persistent memory. Reads your Notion. Drafts your follow-ups. Files your invoices.
*Action*: $2k/mo. No setup fee. Live by Friday.

*Image direction*: Whiteboard sketch of tangled Zapier flows on left, clean org chart on right.

**Hook 3 - Hook Tear-down**
*"What if you could replace your $5k/mo VA with $2k/mo of AI that doesn't sleep?"*
Founder tier. CEO agent at the top, 5 dept managers underneath. You talk to them like Slack DMs. They remember everything. They pull from your company DB.
Started using it last month. Three of my clients fired their VAs.

*Image direction*: Slack DM screenshot, founder asking CEO agent "summarize today's pipeline".`;
    await c.query(
      `insert into rgaios_routine_runs (organization_id, routine_id, source, status, started_at, completed_at, output, created_at)
       values ($1, $2, 'chat_task', 'succeeded', now() - interval '2 hours', now() - interval '1 hour 58 min', $3::jsonb, now() - interval '2 hours')`,
      [orgId, routine1[0].id, JSON.stringify({ reply: sampleOutput, executed_inline: true })],
    );

    // Pending task (will need Claude Max to execute - shows operator how the queue looks)
    await c.query(
      `insert into rgaios_routines (organization_id, title, description, assignee_agent_id, status, created_at, updated_at)
       values ($1, 'Welcome demo: 5 cold-email subject lines', $2, $3, 'active', now(), now())`,
      [
        orgId,
        "Write 5 cold-email subject lines for the 8-step SDR cadence. ICP is service founders $3M-$15M/yr.",
        marketerId,
      ],
    );
    console.log(`✓ inserted 2 demo tasks (1 succeeded with output, 1 pending)`);
  }
}

console.log(`\n${"━".repeat(60)}`);
console.log(`CHRIS DEMO WORKSPACE READY`);
console.log(`${"━".repeat(60)}`);
console.log(`URL:      https://rawclaw-rose.vercel.app/auth/signin`);
console.log(`Email:    ${ownerEmail}`);
console.log(`Password: ${tempPassword}`);
console.log(`Org id:   ${orgId}`);
console.log(`${"━".repeat(60)}`);
console.log(`\nNext: Chris signs in, hits banner "Connect Claude Max" first`);
console.log(`(or skips), explores dashboard with the seeded brand + 6 agents +`);
console.log(`2 demo tasks already populated.`);

await c.end();

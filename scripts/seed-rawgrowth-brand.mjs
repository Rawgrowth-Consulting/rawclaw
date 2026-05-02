// Seed an approved brand profile for rawgrowth-mvp (the platform's own
// admin org). Without it, agents seeded under the admin org reply
// generically because the chat preamble has no brand grounding to inject.
// Idempotent (skips if a non-empty profile already exists).
import "dotenv/config";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }
const c = new pg.Client({ connectionString: url });
await c.connect();

const { rows } = await c.query(
  `select id, name from rgaios_organizations where slug = 'rawgrowth-mvp'`,
);
if (rows.length === 0) { console.error("rawgrowth-mvp org not found"); process.exit(1); }
const org = rows[0];

const { rows: existing } = await c.query(
  `select id from rgaios_brand_profiles where organization_id = $1 and status = 'approved' limit 1`,
  [org.id],
);
if (existing.length > 0) {
  console.log("brand already exists for", org.name, "- skipping");
  process.exit(0);
}

const content = `# Rawgrowth Consulting - Brand Profile

## What we sell
Rawclaw: a per-client AI org that founders deploy in one click. Each
client gets a private dashboard with a CEO agent + department heads
(Marketing, Sales, Fulfilment, Finance, Operations) plus sub-agents,
all wired to Slack + Telegram + their company DB. We sell the platform
+ the operator playbooks that train every agent on how a real ops team
runs. Pricing tiers: founder ($2k/mo), growth ($6k/mo), scale ($15k/mo).

## Who it's for
Founders running $20k-$500k MRR services or coaching businesses who
already burnt time hiring + firing junior ops people and want a
dashboard their team can actually ask "what's my CAC payback this
week" without a meeting.

Not for: enterprise (we don't sell to procurement), pre-revenue
indie hackers (we won't replace your hustle), agencies who want a
white-label seat (we are the agency).

## Voice & tone
Operator-grade. We write like a CTO sending a status update, not a
SaaS marketer. Sentences are short. Verbs are concrete. Numbers
beat adjectives. We avoid the standard SaaS cliche set (full list
in src/lib/brand/tokens.ts).

When the agent doesn't know something, it says "I don't know yet -
let me check" instead of inventing. When the agent gives a
recommendation, it gives ONE recommendation, not three options.

## Positioning
Three things make Rawclaw different from "ChatGPT + Zapier":
1. Persistent per-agent memory (each agent learns the client's
   business over time + remembers prior decisions).
2. One-click hire that auto-trains on company DB (offer docs, sales
   call transcripts, scrape of best-performing content).
3. Brand voice + 11 banned words enforced at build time AND runtime,
   so the agent never drifts off-brand mid-Telegram-thread.

## Frameworks the agents use
- Marketing: AIDA, PAS, hook tear-downs, Eugene Schwartz awareness
  stages.
- Sales: 8-step SDR cadence, MEDDPICC qualification, objection bank.
- Fulfilment: weekly OKR roll-up, project-status RAG (red/amber/green),
  client retention check-in cadence.
- Finance: weekly MRR pull, CAC payback math, cohort LTV, runway.

## Banned words (frozen at 11)
The full list lives in src/lib/brand/tokens.ts. ESLint catches at
build time. applyBrandFilter catches at runtime in every Telegram +
dashboard reply.

## Org chart shape
CEO agent (Atlas) at top. Reports to: human owner. Direct reports:
Marketing Manager, Sales Manager, Operations Manager, Finance
Manager, Fulfilment Manager. Each manager has 1-3 sub-agents
(copywriter, SDR, project-mgr, bookkeeper, etc).

Cross-team work goes through Atlas. Dept heads coordinate sub-agents
within their team directly via the agent_invoke MCP tool.
`;

const now = Date.now();
await c.query(
  `insert into rgaios_brand_profiles (organization_id, version, content, status, generated_at, approved_at, approved_by)
   values ($1, 1, $2, 'approved', $3, $3, 'seed-script')`,
  [org.id, content, now],
);
console.log(`✓ seeded brand profile v1 for ${org.name} (${content.length} chars)`);

await c.end();

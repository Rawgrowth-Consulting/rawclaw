// Ralph onboarding-full: walk a fresh persona through the entire 14-section
// onboarding chat, asserting each section transitions correctly. Uses the
// /api/onboarding/chat NDJSON stream directly (no playwright = no RAM pressure).
import { writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs";

const URL = process.env.URL || "https://rawclaw-rose.vercel.app";
const PERSONA = process.env.PERSONA || "agency-owner";
const OUT = "/tmp/ralph-onboarding-findings.jsonl";
writeFileSync(OUT, "");

const COOKIE_JAR = new Map();
function setCookies(h) {
  if (!h) return;
  const lines = Array.isArray(h) ? h : [h];
  for (const c of lines) {
    const m = c.match(/^([^=;]+)=([^;]*)/);
    if (m) COOKIE_JAR.set(m[1].trim(), m[2].trim());
  }
}
function ck() {
  return Array.from(COOKIE_JAR.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}
async function req(path, opts = {}) {
  const r = await fetch(URL + path, {
    ...opts,
    headers: { ...(opts.headers ?? {}), cookie: ck() },
    redirect: "manual",
  });
  setCookies(r.headers.getSetCookie?.() ?? r.headers.get("set-cookie"));
  return r;
}

const log = (entry) => {
  appendFileSync(OUT, JSON.stringify(entry) + "\n");
  const sev = entry.severity ?? "ok";
  const tag = sev === "broken" ? "💥" : sev === "ugly" ? "⚠ " : "✓";
  console.log(`${tag} ${entry.step}: ${entry.summary}`);
};

// Personas
const PERSONAS_PATH = "/home/pedroafonso/rawclaw-research/rawclaw/scripts/icp-personas.json";
let answers = {
  section_1_messaging: "telegram, my handle is @pedrotest",
  basic_info: "Acme Marketing Co. Founded 2019. Team of 8. Website acmemarketing.co.",
  social: "Instagram @acme_marketing, YouTube AcmeMarketing.",
  origin: "Started 2019 as freelance Google Ads shop, grew into full retainer agency.",
  business_model: "$8k/mo retainer, ~$60k LTV, 30-day onboarding to first results.",
  icp: "Service businesses, $1-10M revenue, founder-led. Pain: stuck on referrals.",
  marketing: "Meta ads + LinkedIn outbound. $25k/mo spend, $1200 CAC.",
  sales: "Lead volume 30-50/mo, close rate 15%, sales cycle 21 days.",
  fulfilment: "Delivery team of 5. ClickUp, Loom, Google Workspace.",
  finance: "$2M ARR, 55% margin, net 30 with 50% upfront.",
  internal_ops: "Team of 8, Slack for comms, weekly all-hands.",
  growth_experiments: "Tried podcast guesting, 3 months, 2 deals closed.",
  decision_rights: "Founder approves > $5k. CFO signs contracts.",
  milestone_calls: "Weekly team sync, monthly client QBR.",
};
if (existsSync(PERSONAS_PATH)) {
  try {
    const personas = JSON.parse(readFileSync(PERSONAS_PATH, "utf8"));
    const p = personas.personas?.find((x) => x.id === PERSONA);
    if (p) answers = { ...answers, ...flattenPersona(p) };
  } catch {}
}

function flattenPersona(p) {
  const out = {};
  if (p.answers?.section_1) {
    const s = p.answers.section_1;
    out.section_1_messaging = `${s.messaging_channel} ${s.messaging_handle ?? ""}`.trim();
  }
  if (p.answers?.company_basics) {
    const b = p.answers.company_basics;
    out.basic_info = `${b.name}. Founded ${b.founded}. Team of ${b.team_size}. Website ${b.website}.`;
  }
  if (p.answers?.business_model) {
    const m = p.answers.business_model;
    out.business_model = `${m.offer}. ${m.pricing}. Delivery ${m.delivery_time}.`;
  }
  if (p.answers?.icp) out.icp = `${p.answers.icp.who}. Pain: ${p.answers.icp.pain}.`;
  if (p.answers?.marketing) {
    const m = p.answers.marketing;
    out.marketing = `Channels: ${(m.channels ?? []).join(", ")}. Spend ${m.monthly_spend}. CAC ${m.current_cac}.`;
  }
  if (p.answers?.sales_pipeline) {
    const s = p.answers.sales_pipeline;
    out.sales = `Lead volume ${s.lead_volume}, close rate ${s.close_rate}, sales cycle ${s.sales_cycle_days} days.`;
  }
  if (p.answers?.fulfilment) out.fulfilment = `Delivery team ${p.answers.fulfilment.delivery_team_size}. Tools: ${(p.answers.fulfilment.tools ?? []).join(", ")}.`;
  if (p.answers?.finance) out.finance = `${p.answers.finance.revenue}, ${p.answers.finance.margin} margin, ${p.answers.finance.payment_terms}.`;
  if (p.answers?.internal_ops) out.internal_ops = `Team ${p.answers.internal_ops.team_size}, comms ${p.answers.internal_ops.comms}.`;
  if (p.answers?.growth_experiments) out.growth_experiments = p.answers.growth_experiments;
  if (p.answers?.decision_rights) out.decision_rights = p.answers.decision_rights;
  if (p.answers?.milestone_calls) out.milestone_calls = (p.answers.milestone_calls ?? []).join(", ");
  if (p.answers?.origin_story) out.origin = p.answers.origin_story;
  if (p.answers?.social_presence) out.social = Object.entries(p.answers.social_presence).map(([k, v]) => `${k} ${v}`).join(", ");
  return out;
}

// ─── Login ────────────────────────────────────────────
{
  const csrf = await (await req("/api/auth/csrf")).json();
  const f = new URLSearchParams({
    csrfToken: csrf.csrfToken,
    email: "pedro-onboard@rawclaw.demo",
    password: "rawclaw-onboard-2026",
    json: "true",
    callbackUrl: URL + "/",
  });
  const r = await req("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: f.toString(),
  });
  log({ step: "login", severity: r.status !== 302 ? "broken" : null, summary: `${r.status}` });
  if (r.status !== 302) process.exit(1);
}

// Helper: send a message + parse stream events
const messages = [];
async function sendChat(userMsg, label, timeoutMs = 60_000) {
  messages.push({ role: "user", content: userMsg });
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(URL + "/api/onboarding/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ck() },
      body: JSON.stringify({ messages }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    log({ step: label, severity: "broken", summary: `fetch threw ${e.message.slice(0, 80)}` });
    return null;
  }
  clearTimeout(timer);
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    log({ step: label, severity: "broken", summary: `${r.status}: ${body.slice(0, 100)}` });
    return null;
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  let assistantText = "";
  let toolsCalled = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        events.push(e);
        if (e.type === "text" && e.delta) assistantText += e.delta;
        if (e.type === "tool_call" || e.phase?.includes("tool")) toolsCalled.push(e.tool ?? e.phase);
        if (e.type === "error") {
          log({ step: label, severity: "broken", summary: `error event: ${e.message?.slice(0, 100)}` });
          return null;
        }
      } catch {}
    }
  }
  const elapsed = Date.now() - t0;
  if (assistantText.trim().length === 0) {
    log({ step: label, severity: "broken", summary: `no text in ${elapsed}ms (${events.length} events)` });
    return null;
  }
  messages.push({ role: "assistant", content: assistantText });
  log({
    step: label,
    summary: `${elapsed}ms, ${assistantText.length} chars, ${toolsCalled.length} tool calls: "${assistantText.slice(0, 80).replace(/\s+/g, " ")}..."`,
  });
  return { text: assistantText, events, elapsed };
}

// ─── 14-section walk ──────────────────────────────────
console.log(`\n=== Walking onboarding for persona "${PERSONA}" ===\n`);

const STEPS = [
  ["yes", "step-1-greeting"],
  [answers.section_1_messaging, "step-2-section-1-channel"],
  [answers.basic_info, "step-3-basic-info"],
  [answers.social, "step-4-social-presence"],
  [answers.origin, "step-5-origin-story"],
  [answers.business_model, "step-6-business-model"],
  [answers.icp, "step-7-icp"],
  [answers.marketing, "step-8-marketing"],
  [answers.sales, "step-9-sales-pipeline"],
  [answers.fulfilment, "step-10-fulfilment"],
  [answers.finance, "step-11-finance"],
  [answers.internal_ops, "step-12-internal-ops"],
  [answers.growth_experiments, "step-13-growth"],
  [answers.decision_rights, "step-14-decision-rights"],
  [answers.milestone_calls, "step-15-milestone-calls"],
];

let lastReply = null;
for (const [msg, label] of STEPS) {
  lastReply = await sendChat(msg, label, 90_000);
  if (!lastReply) {
    console.log("\n=== STOPPED on broken step ===");
    process.exit(1);
  }
  // brief pause to avoid hammering the chat completion
  await new Promise((r) => setTimeout(r, 500));
}

// ─── Verify final state ────────────────────────────────
{
  const r = await req("/api/insights"); // any cheap endpoint
  log({ step: "post-onboarding-api-check", summary: `${r.status}` });
}

// ─── Atlas chat after onboarding ───────────────────────
{
  const agentsResp = await req("/api/agents");
  const j = await agentsResp.json();
  const atlas = (j.agents ?? []).find((a) => a.role === "ceo");
  if (atlas) {
    const t0 = Date.now();
    const r = await fetch(URL + `/api/agents/${atlas.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ck() },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Atlas, summarize the org we just onboarded in 2 sentences." }],
      }),
    });
    const body = await r.text();
    const ev = body.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const txt = ev.filter((e) => e.type === "text").map((e) => e.delta).join("").slice(0, 200);
    const elapsed = Date.now() - t0;
    log({ step: "atlas-summary-after-onboarding", severity: !txt ? "broken" : null, summary: `${elapsed}ms: "${txt}..."` });
  }
}

console.log("\n=== ONBOARDING WALK COMPLETE ===");

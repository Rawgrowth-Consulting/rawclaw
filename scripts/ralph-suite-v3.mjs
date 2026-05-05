// Ralph v3 - deep dive: agent panel tabs, hire flow, routine CRUD,
// connections cards, mini-saas generate, sales call upload.
import { chromium } from "playwright";
import { writeFileSync, appendFileSync } from "node:fs";

const URL = process.env.URL || "https://rawclaw-rose.vercel.app";
const OUT = "/tmp/ralph-v3-findings.jsonl";
writeFileSync(OUT, "");

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const findings = [];
const log = (e) => {
  findings.push(e);
  appendFileSync(OUT, JSON.stringify(e) + "\n");
  const sev = e.severity ?? "ok";
  const tag = sev === "broken" ? "💥" : sev === "ugly" ? "⚠ " : sev === "minor" ? "·" : "✓";
  console.log(`${tag} ${e.surface}: ${e.summary}`);
};

// Login
{
  const csrf = await (await ctx.request.get(URL + "/api/auth/csrf")).json();
  const auth = await ctx.request.post(URL + "/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: "pedro-onboard@rawclaw.demo",
      password: "rawclaw-onboard-2026",
      json: "true",
      callbackUrl: URL + "/",
    },
    headers: { "content-type": "application/x-www-form-urlencoded" },
    maxRedirects: 0,
  });
  log({ surface: "login", summary: `${auth.status()}` });
}

// Find Atlas id
const agentsResp = await ctx.request.get(URL + "/api/agents");
const agentsBody = await agentsResp.json();
const atlas = (agentsBody.agents ?? []).find((a) => a.role === "ceo");
if (!atlas) {
  log({ surface: "agent-panel", severity: "broken", summary: "no Atlas found" });
  await browser.close();
  process.exit(1);
}

// Test 1: Agent panel - all tabs render
const TABS = ["overview", "memory", "files", "tasks", "settings", "chat"];
for (const tab of TABS) {
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120)); });
  let resp;
  try {
    resp = await page.goto(`${URL}/agents/${atlas.id}?tab=${tab}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (e) {
    log({ surface: `agent-tab-${tab}`, severity: "broken", summary: `goto threw ${e.message.slice(0, 60)}` });
    await page.close();
    continue;
  }
  await page.waitForTimeout(2500);
  const text = await page.locator("body").innerText().catch(() => "");
  const blank = text.trim().length < 50;
  const hasTab = text.toLowerCase().includes(tab) || text.includes("Atlas");
  let severity = null, summary = `${resp.status()}`;
  if (resp.status() >= 500) { severity = "broken"; summary = `${resp.status()}`; }
  else if (blank) { severity = "broken"; summary = "blank"; }
  else if (consoleErrors.length > 0) { severity = "minor"; summary = `${resp.status()} + ${consoleErrors.length} console errors`; }
  else if (!hasTab) { severity = "minor"; summary = `${resp.status()} but tab text missing`; }
  log({ surface: `agent-tab-${tab}`, severity, summary, consoleErrors: consoleErrors.slice(0, 2) });
  await page.close();
}

// Test 2: Hire flow - open sheet, fill form, NOT submit (read-only check)
{
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120)); });
  await page.goto(URL + "/agents", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  // Find a "+ hire" or "+ agent" or "+ sub" button
  const hireBtn = page.locator('button:has-text("Hire"), button:has-text("+ Sub"), button:has-text("+ Agent"), button:has-text("+ hire"), [aria-label*="hire" i]').first();
  if ((await hireBtn.count()) === 0) {
    log({ surface: "hire-flow", severity: "ugly", summary: "no Hire/+ button found on /agents" });
  } else {
    await hireBtn.click().catch(() => {});
    await page.waitForTimeout(2000);
    const sheetVisible = await page.locator('[role="dialog"], [data-state="open"], .sheet').first().isVisible().catch(() => false);
    log({ surface: "hire-flow", severity: sheetVisible ? null : "ugly", summary: sheetVisible ? "sheet opened on click" : "click did not open sheet", consoleErrors: consoleErrors.slice(0, 2) });
  }
  await page.close();
}

// Test 3: /routines - list renders + create button
{
  const page = await ctx.newPage();
  const netFails = [];
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 400 && !u.includes("/_next/") && !u.includes("favicon")) {
      netFails.push({ status: r.status(), url: u.slice(-60) });
    }
  });
  await page.goto(URL + "/routines", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const text = await page.locator("body").innerText().catch(() => "");
  const hasRoutineWord = /routine|schedule|cadence/i.test(text);
  log({ surface: "routines-page", severity: !hasRoutineWord ? "ugly" : null, summary: hasRoutineWord ? `OK (${text.length} chars)` : "no routine-related text", netFails: netFails.slice(0, 3) });
  await page.close();
}

// Test 4: /connections - cards render
{
  const page = await ctx.newPage();
  const netFails = [];
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 400 && !u.includes("/_next/") && !u.includes("favicon")) {
      netFails.push({ status: r.status(), url: u.slice(-60) });
    }
  });
  await page.goto(URL + "/connections", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const text = await page.locator("body").innerText().catch(() => "");
  const cards = ["Claude Max", "Slack", "Telegram", "Gmail"];
  const found = cards.filter((c) => text.includes(c));
  log({ surface: "connections-cards", severity: found.length < 2 ? "ugly" : null, summary: `${found.length}/${cards.length} cards visible: ${found.join(",")}`, netFails: netFails.slice(0, 3) });
  await page.close();
}

// Test 5: /mini-saas - generate flow (don't actually submit, just check input visible)
{
  const page = await ctx.newPage();
  await page.goto(URL + "/mini-saas", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const text = await page.locator("body").innerText().catch(() => "");
  const hasInput = (await page.locator('textarea, input[type="text"]').count()) > 0;
  log({ surface: "mini-saas", severity: !hasInput ? "ugly" : null, summary: hasInput ? "input visible" : "no input", textLen: text.length });
  await page.close();
}

// Test 6: /sales-calls - render + upload area
{
  const page = await ctx.newPage();
  await page.goto(URL + "/sales-calls", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const text = await page.locator("body").innerText().catch(() => "");
  const hasUpload = (await page.locator('input[type="file"], [data-drop], button:has-text("Upload")').count()) > 0;
  log({ surface: "sales-calls", severity: !hasUpload ? "ugly" : null, summary: hasUpload ? "upload control visible" : "no upload control" });
  await page.close();
}

// Test 7: /approvals - approve/reject buttons
{
  const page = await ctx.newPage();
  await page.goto(URL + "/approvals", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const text = await page.locator("body").innerText().catch(() => "");
  const hasEmpty = /no pending|nothing|empty/i.test(text);
  log({ surface: "approvals", summary: hasEmpty ? "empty state shown" : `text=${text.length} chars` });
  await page.close();
}

// Test 8: /skills - marketplace renders
{
  const page = await ctx.newPage();
  await page.goto(URL + "/skills", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const text = await page.locator("body").innerText().catch(() => "");
  const hasSkills = /skill|marketplace|brief|persona/i.test(text);
  log({ surface: "skills", severity: !hasSkills ? "ugly" : null, summary: hasSkills ? "skills text present" : "no skills text" });
  await page.close();
}

// Test 9: /tasks - list render
{
  const page = await ctx.newPage();
  await page.goto(URL + "/tasks", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const text = await page.locator("body").innerText().catch(() => "");
  const len = text.length;
  log({ surface: "tasks", severity: len < 100 ? "ugly" : null, summary: `${len} chars rendered` });
  await page.close();
}

// Test 10: /updates - feed
{
  const page = await ctx.newPage();
  await page.goto(URL + "/updates", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const text = await page.locator("body").innerText().catch(() => "");
  const hasUpdates = /update|atlas|insight|task/i.test(text);
  log({ surface: "updates", severity: !hasUpdates ? "ugly" : null, summary: hasUpdates ? "feed text present" : "no feed text" });
  await page.close();
}

// Summary
const broken = findings.filter((f) => f.severity === "broken");
const ugly = findings.filter((f) => f.severity === "ugly");
const minor = findings.filter((f) => f.severity === "minor");
console.log("\n=== RALPH V3 DEEP-DIVE SUMMARY ===");
console.log(`broken: ${broken.length}, ugly: ${ugly.length}, minor: ${minor.length}, ok: ${findings.length - broken.length - ugly.length - minor.length}`);
for (const b of broken) console.log(`  💥 ${b.surface}: ${b.summary}`);
for (const u of ugly) console.log(`  ⚠  ${u.surface}: ${u.summary}`);
for (const m of minor) console.log(`  · ${m.surface}: ${m.summary}`);

await browser.close();
process.exit(broken.length > 0 ? 1 : 0);

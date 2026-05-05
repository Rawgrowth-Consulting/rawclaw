// Ralph v4 - heavy flows: full onboarding sequence, agent chat back-and-forth,
// insights sweep, mini-saas sheet inspection.
import { chromium } from "playwright";
import { writeFileSync, appendFileSync } from "node:fs";

const URL = process.env.URL || "https://rawclaw-rose.vercel.app";
const OUT = "/tmp/ralph-v4-findings.jsonl";
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
  await ctx.request.post(URL + "/api/auth/callback/credentials", {
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
  log({ surface: "login", summary: "OK" });
}

// Test 1: Mini-saas sheet form (re-check with longer wait + portal scope)
{
  const page = await ctx.newPage();
  await page.goto(URL + "/mini-saas", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const newBtn = page.locator('button:has-text("New mini")').first();
  if ((await newBtn.count()) === 0) {
    log({ surface: "mini-saas-sheet", severity: "broken", summary: "no New button" });
  } else {
    await newBtn.click();
    await page.waitForTimeout(3500);
    // search the entire DOM including portals
    const ta = await page.locator('textarea').count();
    const inp = await page.locator('input[type="text"]').count();
    const titleInp = await page.locator('input[name*="title" i], input[placeholder*="calc" i]').count();
    if (ta + inp + titleInp === 0) {
      log({ surface: "mini-saas-sheet", severity: "ugly", summary: "sheet opened but no form fields visible" });
    } else {
      log({ surface: "mini-saas-sheet", summary: `ta=${ta} text-inp=${inp} title-inp=${titleInp}` });
    }
  }
  await page.close();
}

// Test 2: Atlas chat real reply (POST a msg, expect text back)
{
  const agentsResp = await ctx.request.get(URL + "/api/agents");
  const j = await agentsResp.json();
  const atlas = (j.agents ?? []).find((a) => a.role === "ceo");
  if (!atlas) {
    log({ surface: "atlas-chat-reply", severity: "broken", summary: "no Atlas in /api/agents" });
  } else {
    const t0 = Date.now();
    const r = await ctx.request.post(URL + `/api/agents/${atlas.id}/chat`, {
      headers: { "content-type": "application/json" },
      data: JSON.stringify({
        messages: [{ role: "user", content: "Quick check - say hi back, one sentence." }],
      }),
      timeout: 90_000,
    });
    const elapsed = Date.now() - t0;
    if (!r.ok()) {
      const txt = await r.text();
      log({ surface: "atlas-chat-reply", severity: "broken", summary: `${r.status()} in ${elapsed}ms: ${txt.slice(0, 150)}` });
    } else {
      // Read NDJSON stream
      const body = await r.text();
      const events = body.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const hasText = events.some((e) => e.type === "text" && e.delta);
      const hasError = events.find((e) => e.type === "error");
      const textSample = events.filter((e) => e.type === "text" && e.delta).map((e) => e.delta).join("").slice(0, 120);
      if (hasError) {
        log({ surface: "atlas-chat-reply", severity: "broken", summary: `error event: ${hasError.message?.slice(0, 100)}` });
      } else if (!hasText) {
        log({ surface: "atlas-chat-reply", severity: "broken", summary: `no text events in ${elapsed}ms (${events.length} events)` });
      } else {
        log({ surface: "atlas-chat-reply", summary: `replied in ${elapsed}ms: ${textSample}` });
      }
    }
  }
}

// Test 3: Insights sweep POST
{
  const t0 = Date.now();
  const r = await ctx.request.post(URL + "/api/insights?sweep=true", { timeout: 120_000 });
  const elapsed = Date.now() - t0;
  if (!r.ok()) {
    const txt = await r.text();
    log({ surface: "insights-sweep", severity: "broken", summary: `${r.status()} in ${elapsed}ms: ${txt.slice(0, 120)}` });
  } else {
    const j = await r.json();
    log({ surface: "insights-sweep", summary: `${r.status()} in ${elapsed}ms: created=${j.created ?? "?"}, skipped=${j.skipped ?? "?"}` });
  }
}

// Test 4: /api/insights returns the new ones (or 0 if nothing actionable)
{
  const r = await ctx.request.get(URL + "/api/insights");
  const j = await r.json();
  log({ surface: "insights-list-after-sweep", summary: `${r.status()}: ${(j.insights ?? []).length} insights` });
}

// Test 5: /api/agents/[id]/chat GET history shape
{
  const agentsResp = await ctx.request.get(URL + "/api/agents");
  const j = await agentsResp.json();
  const atlas = (j.agents ?? []).find((a) => a.role === "ceo");
  if (atlas) {
    const r = await ctx.request.get(URL + `/api/agents/${atlas.id}/chat`);
    const body = await r.json();
    const ok = Array.isArray(body.messages) && r.ok();
    log({ surface: "agent-chat-history", severity: !ok ? "ugly" : null, summary: `${r.status()} ${body.messages?.length ?? 0} msgs` });
  }
}

// Test 6: Atlas-coordinate cron (without auth, just see what happens)
{
  const r = await ctx.request.get(URL + "/api/cron/atlas-coordinate");
  log({ surface: "cron-atlas-coordinate-no-auth", severity: r.status() === 401 ? null : "ugly", summary: `${r.status()} (expected 401 without bearer)` });
}

// Test 7: /api/onboarding/chat - smoke (gate check)
{
  const r = await ctx.request.post(URL + "/api/onboarding/chat", {
    headers: { "content-type": "application/json" },
    data: JSON.stringify({ messages: [{ role: "user", content: "yes" }] }),
    timeout: 60_000,
  });
  // Expected 200 stream or 4xx if unauth. Check.
  log({ surface: "onboarding-chat-api", severity: r.status() >= 500 ? "broken" : null, summary: `${r.status()}` });
}

// Test 8: /api/data/ingest handles short text gracefully (expect 400)
{
  const r = await ctx.request.post(URL + "/api/data/ingest", {
    headers: { "content-type": "application/json" },
    data: JSON.stringify({ source: "note", label: "short", text: "abc" }),
  });
  // We expect 400 for too-short text
  log({ surface: "data-ingest-validation", severity: r.status() === 400 ? null : "ugly", summary: `${r.status()} (expected 400 for <10 chars)` });
}

// Test 9: /api/insights/[id]/open-chat with invalid UUID
{
  const r = await ctx.request.post(URL + `/api/insights/00000000-0000-0000-0000-000000000000/open-chat`);
  log({ surface: "open-chat-invalid-id", severity: r.status() === 404 ? null : "ugly", summary: `${r.status()} (expected 404)` });
}

// Test 10: Notification bell mark-read flow
{
  const page = await ctx.newPage();
  await page.goto(URL + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const bell = page.locator('button:has(svg.lucide-bell)').first();
  await bell.click().catch(() => {});
  await page.waitForTimeout(1500);
  const dropdown = await page.locator('[role="menu"], [data-state="open"]').count();
  log({ surface: "bell-dropdown", severity: dropdown === 0 ? "ugly" : null, summary: `dropdown elements: ${dropdown}` });
  await page.close();
}

// Summary
const broken = findings.filter((f) => f.severity === "broken");
const ugly = findings.filter((f) => f.severity === "ugly");
console.log("\n=== RALPH V4 HEAVY-FLOWS SUMMARY ===");
console.log(`broken: ${broken.length}, ugly: ${ugly.length}, ok: ${findings.length - broken.length - ugly.length}`);
for (const b of broken) console.log(`  💥 ${b.surface}: ${b.summary}`);
for (const u of ugly) console.log(`  ⚠  ${u.surface}: ${u.summary}`);

await browser.close();
process.exit(broken.length > 0 ? 1 : 0);

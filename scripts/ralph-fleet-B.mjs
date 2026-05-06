// Ralph-fleet WORKER B - 10 iterations across 9 surfaces (90 total).
// LOCAL DEV http://localhost:3002. LIST + CRUD flows, no LLM-heavy chat.
// Surfaces: agents, tasks, routines, skills, company, approvals, mini-saas, booking, admin.
// Findings -> /tmp/ralph-fleet-B-findings.jsonl

import { chromium } from "playwright";
import { writeFileSync, appendFileSync, existsSync } from "node:fs";

const URL = process.env.URL || "http://localhost:3002";
const OUT = process.env.OUT || "/tmp/ralph-fleet-B-findings.jsonl";
const EMAIL = process.env.EMAIL || "pedro-onboard@rawclaw.demo";
const PASSWORD = process.env.PASSWORD || "rawclaw-onboard-2026";
const ITERATIONS = Number(process.env.ITERATIONS || 10);

if (!existsSync(OUT)) writeFileSync(OUT, "");

const log = (e) => {
  const ev = { ts: new Date().toISOString(), worker: "B", ...e };
  appendFileSync(OUT, JSON.stringify(ev) + "\n");
  const sev = ev.severity ?? "ok";
  const tag = sev === "broken" ? "BROKEN" : sev === "ugly" ? "UGLY" : sev === "minor" ? "MINOR" : "OK";
  console.log(`[${tag}] iter${ev.iter ?? "?"}/${ev.surface}: ${ev.summary}`);
};

function isSpuriousError(text) {
  if (/"error":"\$undefined"/.test(text)) return true;
  if (/Failed to load resource: the server responded with a status of 401/.test(text)) return true;
  if (/manifest\.json|favicon/.test(text)) return true;
  if (/Hydration|hydrat/i.test(text)) return false;
  return false;
}

const browser = await chromium.launch({ headless: true });

async function makeContext(email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  let csrfToken = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const csrfRaw = await ctx.request.get(URL + "/api/auth/csrf", { timeout: 60_000 });
      const j = await csrfRaw.json();
      csrfToken = j.csrfToken;
      if (csrfToken) break;
    } catch (e) {
      console.log(`[login] csrf attempt ${attempt} failed: ${e.message.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!csrfToken) {
    log({ surface: "login.bootstrap", severity: "broken", summary: "csrf 5x failed" });
    return null;
  }
  await ctx.request.post(URL + "/api/auth/callback/credentials", {
    form: { csrfToken, email, password, json: "true", callbackUrl: URL + "/" },
    headers: { "content-type": "application/x-www-form-urlencoded" },
    maxRedirects: 0,
    timeout: 30_000,
  });
  const me = await ctx.request.get(URL + "/api/org/me", { timeout: 30_000 });
  if (!me.ok()) {
    log({ surface: "login.bootstrap", severity: "broken", summary: `org/me ${me.status()} for ${email}` });
    return null;
  }
  const meJson = await me.json();
  log({ surface: "login.bootstrap", summary: `OK ${email} org=${meJson.activeOrgId ?? "?"}` });
  return ctx;
}

async function newProbedPage(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/")) requests.push({ url: u, status: r.status() });
  });
  return { page, errors, requests };
}

async function snapshot(page, name) {
  try {
    const path = `/tmp/ralph-B-${name}.png`;
    await page.screenshot({ path, fullPage: false });
    return path;
  } catch (e) {
    return null;
  }
}

const ctx = await makeContext(EMAIL, PASSWORD);
if (!ctx) {
  await browser.close();
  process.exit(1);
}

// =========================================================
// SURFACE 1: /agents list + 6 panel tabs + hire sheet
// =========================================================
async function surface1_agents(iter) {
  const { page, errors } = await newProbedPage(ctx);
  try {
    const resp = await page.goto(URL + "/agents", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1800);
    const status = resp?.status() ?? 0;
    if (status >= 400) {
      await snapshot(page, `s1-i${iter}-list`);
      log({ iter, surface: "agents.list", severity: "broken", summary: `status=${status}` });
      return;
    }
    const cards = await page.locator('a[href^="/agents/"]').count();
    log({ iter, surface: "agents.list", summary: `status=${status} cards=${cards}` });
    if (cards === 0) {
      log({ iter, surface: "agents.list", severity: "ugly", summary: "no agent cards" });
      return;
    }
    // Drill into first agent for tabs
    const firstHref = await page.locator('a[href^="/agents/"]').first().getAttribute("href");
    if (!firstHref) return;
    await page.goto(URL + firstHref, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1500);
    // Real tabs in AgentPanelClient.tsx: chat, vision, memory, files, tasks, settings
    const tabs = ["chat", "vision", "memory", "files", "tasks", "settings"];
    let passed = 0;
    for (const tab of tabs) {
      const tabBtn = page.getByRole("button", { name: new RegExp(`^${tab}$`, "i") });
      const cnt = await tabBtn.count().catch(() => 0);
      if (cnt === 0) {
        log({ iter, surface: `agent.tab.${tab}`, severity: "ugly", summary: "tab missing" });
        continue;
      }
      try {
        await tabBtn.first().click({ timeout: 3000 });
        await page.waitForTimeout(700);
        passed++;
      } catch (e) {
        log({ iter, surface: `agent.tab.${tab}`, severity: "ugly", summary: `click fail ${e.message.slice(0, 60)}` });
      }
    }
    log({ iter, surface: "agent.tabs.summary", summary: `${passed}/6 tabs clicked`, severity: passed < 4 ? "ugly" : undefined });
  } catch (e) {
    log({ iter, surface: "agents.list", severity: "broken", summary: `exception ${e.message.slice(0, 80)}` });
  } finally {
    await page.close();
  }
}

async function surface1_agents_hire(iter) {
  const { page } = await newProbedPage(ctx);
  try {
    await page.goto(URL + "/agents", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1800);
    const before = await page.locator('a[href^="/agents/"]').count();
    const hireBtn = page.locator('button:has-text("Hire"), a:has-text("Hire")').first();
    if (await hireBtn.count() === 0) {
      log({ iter, surface: "agents.hire-button", severity: "broken", summary: "no Hire button" });
      return;
    }
    await hireBtn.click({ timeout: 3000 });
    await page.waitForTimeout(1200);
    const dialog = await page.locator('[role="dialog"], [data-radix-popper-content-wrapper]').count();
    if (dialog === 0) {
      log({ iter, surface: "agents.hire-sheet", severity: "broken", summary: "sheet did not open" });
      return;
    }
    const roleInput = page.locator('[role="dialog"] input[list]').first();
    if (await roleInput.count() === 0) {
      log({ iter, surface: "agents.hire-sheet", severity: "ugly", summary: "no role input" });
      return;
    }
    const role = `worker-B test role iter${iter}`;
    await roleInput.fill(role);
    await page.waitForTimeout(200);
    // Try name input if visible
    const nameInput = page.locator('[role="dialog"] input[name="name"], [role="dialog"] input[placeholder*="ame" i]').first();
    if (await nameInput.count() > 0) {
      await nameInput.fill(`B-iter${iter}-${Date.now() % 1000}`).catch(() => {});
    }
    const submit = page.locator('[role="dialog"] button:has-text("Hire")').last();
    let postStatus = null;
    let postBody = "";
    const respPromise = page.waitForResponse(
      (r) => r.url().endsWith("/api/agents") && r.request().method() === "POST",
      { timeout: 8000 },
    ).catch(() => null);
    await submit.click({ timeout: 3000 });
    const resp = await respPromise;
    if (resp) {
      postStatus = resp.status();
      try { postBody = (await resp.text()).slice(0, 120); } catch {}
    }
    await page.waitForTimeout(1500);
    // Check toast
    const toastText = await page.locator('[data-sonner-toast]').innerText().catch(() => "");
    const success = (postStatus !== null && postStatus < 400) || /Hired|created|success/i.test(toastText);
    if (!success) {
      await snapshot(page, `s1-i${iter}-hire-fail`);
      log({ iter, surface: "agents.hire-flow", severity: "broken", summary: `status=${postStatus} toast="${toastText.slice(0, 80)}" body="${postBody}"` });
    } else {
      log({ iter, surface: "agents.hire-flow", summary: `status=${postStatus} toast="${toastText.slice(0, 60)}"` });
      // Verify agent appeared in list
      await page.goto(URL + "/agents", { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(1500);
      const after = await page.locator('a[href^="/agents/"]').count();
      log({ iter, surface: "agents.hire-list-grew", summary: `${before}->${after}`, severity: after <= before ? "ugly" : undefined });
    }
  } catch (e) {
    log({ iter, surface: "agents.hire-flow", severity: "broken", summary: `exception ${e.message.slice(0, 80)}` });
  } finally {
    await page.close();
  }
}

// =========================================================
// SURFACE 2: /tasks list + first row drill
// =========================================================
async function surface2_tasks(iter) {
  const { page } = await newProbedPage(ctx);
  try {
    const resp = await page.goto(URL + "/tasks", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1800);
    const status = resp?.status() ?? 0;
    if (status >= 400) {
      await snapshot(page, `s2-i${iter}-list`);
      log({ iter, surface: "tasks.list", severity: "broken", summary: `status=${status}` });
      return;
    }
    const rows = await page.locator('a[href^="/tasks/"], [data-task-row]').count();
    log({ iter, surface: "tasks.list", summary: `status=${status} rows=${rows}` });
    if (rows === 0) {
      // Empty state OK
      const emptyText = await page.locator("body").innerText().catch(() => "");
      log({ iter, surface: "tasks.list.empty", summary: `body=${emptyText.slice(0, 60)}` });
      return;
    }
    const firstHref = await page.locator('a[href^="/tasks/"]').first().getAttribute("href");
    if (firstHref) {
      const drillResp = await page.goto(URL + firstHref, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(1200);
      const drillStatus = drillResp?.status() ?? 0;
      const mainText = (await page.locator("main").innerText().catch(() => "")).slice(0, 100);
      log({
        iter, surface: "tasks.drill",
        summary: `status=${drillStatus} main-len=${mainText.length}`,
        severity: drillStatus >= 400 ? "broken" : (mainText.length === 0 ? "ugly" : undefined),
      });
    }
  } catch (e) {
    log({ iter, surface: "tasks.list", severity: "broken", summary: `exception ${e.message.slice(0, 80)}` });
  } finally {
    await page.close();
  }
}

// =========================================================
// SURFACE 3: /routines list + new routine sheet
// =========================================================
async function surface3_routines(iter) {
  const { page } = await newProbedPage(ctx);
  try {
    const resp = await page.goto(URL + "/routines", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3500);
    const status = resp?.status() ?? 0;
    if (status >= 400) {
      log({ iter, surface: "routines.list", severity: "broken", summary: `status=${status}` });
      return;
    }
    // Wait for hydration: either RoutineSheet trigger or row appears
    await page.waitForSelector(
      '[data-slot="sheet-trigger"], div.group.rounded-md',
      { timeout: 12000 },
    ).catch(() => null);
    const triggers = await page.locator('[data-slot="sheet-trigger"]').count();
    const rows = await page.locator('div.group.rounded-md.border-border').count();
    log({ iter, surface: "routines.list", summary: `status=${status} rows=${rows} triggers=${triggers}` });
    // Click new routine. Empty state shows "Create first routine"; populated shows "New routine".
    const newBtn = page.locator('[data-slot="sheet-trigger"]').first();
    if (await newBtn.count() === 0) {
      log({ iter, surface: "routines.new-button", severity: "ugly", summary: "no New routine button" });
      return;
    }
    await newBtn.click({ timeout: 3000 });
    await page.waitForTimeout(1200);
    const dialog = await page.locator('[role="dialog"], [data-radix-popper-content-wrapper]').count();
    if (dialog === 0) {
      await snapshot(page, `s3-i${iter}-no-sheet`);
      log({ iter, surface: "routines.new-sheet", severity: "broken", summary: "sheet did not open" });
      return;
    }
    log({ iter, surface: "routines.new-sheet", summary: "sheet opened" });
    // Look for cron preset, agent picker, save button
    const cronInputs = await page.locator('[role="dialog"] select, [role="dialog"] [role="combobox"], [role="dialog"] input[placeholder*="ron" i]').count();
    const agentPicker = await page.locator('[role="dialog"] [role="combobox"], [role="dialog"] select').count();
    const saveBtn = page.locator('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("Create")').last();
    log({
      iter, surface: "routines.new-sheet.fields",
      summary: `cron=${cronInputs} agentPicker=${agentPicker} save=${await saveBtn.count()}`,
      severity: cronInputs === 0 && agentPicker === 0 ? "ugly" : undefined,
    });
  } catch (e) {
    log({ iter, surface: "routines.list", severity: "broken", summary: `exception ${e.message.slice(0, 80)}` });
  } finally {
    await page.close();
  }
}

// =========================================================
// SURFACE 4: /skills marketplace tiles + first detail
// =========================================================
async function surface4_skills(iter) {
  const { page } = await newProbedPage(ctx);
  try {
    const resp = await page.goto(URL + "/skills", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1800);
    const status = resp?.status() ?? 0;
    if (status >= 400) {
      log({ iter, surface: "skills.list", severity: "broken", summary: `status=${status}` });
      return;
    }
    // Wait for hydration: catalog loads via SWR. Each tile is a <button> wrapping a Card.
    await page.waitForSelector("main button.group", { timeout: 10000 }).catch(() => null);
    const tiles = await page.locator("main button.group").count();
    log({ iter, surface: "skills.list", summary: `status=${status} tiles=${tiles}` });
    if (tiles === 0) {
      const text = (await page.locator("body").innerText().catch(() => "")).slice(0, 200);
      log({ iter, surface: "skills.empty", summary: text.replace(/\s+/g, " ").slice(0, 100) });
      return;
    }
    try {
      await page.locator("main button.group").first().click({ timeout: 3000 });
      await page.waitForTimeout(1200);
      const dialog = await page.locator('[role="dialog"]').count();
      const detailText = (await page.locator('[role="dialog"]').innerText().catch(() => "")).slice(0, 100);
      log({
        iter, surface: "skills.detail",
        summary: `dialog=${dialog} len=${detailText.length}`,
        severity: dialog === 0 ? "ugly" : undefined,
      });
    } catch (e) {
      log({ iter, surface: "skills.detail", severity: "ugly", summary: `click fail ${e.message.slice(0, 60)}` });
    }
  } catch (e) {
    log({ iter, surface: "skills.list", severity: "broken", summary: `exception ${e.message.slice(0, 80)}` });
  } finally {
    await page.close();
  }
}

// =========================================================
// SURFACE 5: /company members + autonomous toggle
// =========================================================
async function surface5_company(iter) {
  const { page, requests } = await newProbedPage(ctx);
  try {
    const resp = await page.goto(URL + "/company/members", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1800);
    const status = resp?.status() ?? 0;
    if (status >= 400) {
      log({ iter, surface: "company.members", severity: "broken", summary: `status=${status}` });
      return;
    }
    const memberRows = await page.locator('[data-member-id], tr, [role="row"]').count();
    log({ iter, surface: "company.members", summary: `status=${status} rows=${memberRows}` });
    // Try /company/autonomous if exists
    const autoResp = await page.goto(URL + "/company/autonomous", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1500);
    const autoStatus = autoResp?.status() ?? 0;
    if (autoStatus >= 400) {
      log({ iter, surface: "company.autonomous", severity: "broken", summary: `status=${autoStatus}` });
      return;
    }
    // Custom radio pills for Off/Review/On + "Save changes" button.
    const pills = page.locator('main button:has-text("Off"), main button:has-text("Review"), main button:has-text("On")');
    const pillCount = await pills.count();
    const saveBtn = page.locator('button:has-text("Save changes")').first();
    log({ iter, surface: "company.autonomous", summary: `status=${autoStatus} pills=${pillCount} save=${await saveBtn.count()}` });
    if (pillCount === 0) {
      log({ iter, surface: "company.autonomous.pills", severity: "ugly", summary: "no mode pills visible" });
      return;
    }
    // Click whichever pill is NOT currently active to ensure dirty + save enabled.
    try {
      // Find first pill that does NOT have "Active" badge text inside.
      let targetIdx = 0;
      for (let i = 0; i < pillCount; i++) {
        const txt = await pills.nth(i).innerText().catch(() => "");
        if (!/active/i.test(txt)) { targetIdx = i; break; }
      }
      await pills.nth(targetIdx).click({ timeout: 3000 });
      await page.waitForTimeout(500);
      const respPromise = page.waitForResponse(
        (r) => r.url().includes("/api/company/autonomous") && r.request().method() === "POST",
        { timeout: 6000 },
      ).catch(() => null);
      await saveBtn.click({ timeout: 3000 }).catch(() => null);
      const resp = await respPromise;
      const postStatus = resp ? resp.status() : null;
      log({
        iter, surface: "company.autonomous.toggle",
        summary: `post=${postStatus}`,
        severity: (postStatus && postStatus >= 500) ? "broken" : (postStatus === null ? "ugly" : undefined),
      });
    } catch (e) {
      log({ iter, surface: "company.autonomous.toggle", severity: "ugly", summary: `click fail ${e.message.slice(0, 60)}` });
    }
  } catch (e) {
    log({ iter, surface: "company.members", severity: "broken", summary: `exception ${e.message.slice(0, 80)}` });
  } finally {
    await page.close();
  }
}

// =========================================================
// SURFACE 6: /approvals - empty state OR pending
// =========================================================
async function surface6_approvals(iter) {
  const { page } = await newProbedPage(ctx);
  try {
    const resp = await page.goto(URL + "/approvals", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1800);
    const status = resp?.status() ?? 0;
    if (status >= 400) {
      log({ iter, surface: "approvals.list", severity: "broken", summary: `status=${status}` });
      return;
    }
    const items = await page.locator('[data-approval-id], [data-testid*="approval"]').count();
    const mainText = (await page.locator("main").last().innerText().catch(() => "")).slice(0, 400);
    const isEmpty = /no approvals|nothing to approve|nothing pending|all clear|inbox.*zero/i.test(mainText);
    log({ iter, surface: "approvals.list", summary: `status=${status} items=${items} empty=${isEmpty}` });
    // If items, try clicking first approve button
    if (items > 0) {
      const approveBtn = page.locator('button:has-text("Approve")').first();
      if (await approveBtn.count() > 0) {
        try {
          await approveBtn.click({ timeout: 3000 });
          await page.waitForTimeout(1500);
          log({ iter, surface: "approvals.approve", summary: "click ok" });
        } catch (e) {
          log({ iter, surface: "approvals.approve", severity: "ugly", summary: e.message.slice(0, 60) });
        }
      }
    }
  } catch (e) {
    log({ iter, surface: "approvals.list", severity: "broken", summary: `exception ${e.message.slice(0, 80)}` });
  } finally {
    await page.close();
  }
}

// =========================================================
// SURFACE 7: /mini-saas list + new sheet
// =========================================================
async function surface7_minisaas(iter) {
  const { page } = await newProbedPage(ctx);
  try {
    const resp = await page.goto(URL + "/mini-saas", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1800);
    const status = resp?.status() ?? 0;
    if (status >= 400) {
      log({ iter, surface: "mini-saas.list", severity: "broken", summary: `status=${status}` });
      return;
    }
    const rows = await page.locator('a[href*="/mini-saas/"]').count();
    log({ iter, surface: "mini-saas.list", summary: `status=${status} rows=${rows}` });
    const newBtn = page.locator('button:has-text("New mini SaaS"), button:has-text("New"), a:has-text("New mini SaaS")').first();
    if (await newBtn.count() === 0) {
      log({ iter, surface: "mini-saas.new-button", severity: "ugly", summary: "no New button" });
      return;
    }
    await newBtn.click({ timeout: 3000 });
    await page.waitForTimeout(1200);
    const dialog = await page.locator('[role="dialog"]').count();
    if (dialog === 0) {
      log({ iter, surface: "mini-saas.new-sheet", severity: "broken", summary: "sheet did not open" });
      return;
    }
    // Title input has placeholder "CAC payback calculator"; description is textarea.
    const titleInput = await page.locator('[role="dialog"] input').count();
    const descInput = await page.locator('[role="dialog"] textarea').count();
    log({
      iter, surface: "mini-saas.new-sheet",
      summary: `title-input=${titleInput} desc-input=${descInput}`,
      severity: (titleInput === 0 || descInput === 0) ? "ugly" : undefined,
    });
  } catch (e) {
    log({ iter, surface: "mini-saas.list", severity: "broken", summary: `exception ${e.message.slice(0, 80)}` });
  } finally {
    await page.close();
  }
}

// =========================================================
// SURFACE 8: /booking page + visible action
// =========================================================
async function surface8_booking(iter) {
  const { page } = await newProbedPage(ctx);
  try {
    const resp = await page.goto(URL + "/booking", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1800);
    const status = resp?.status() ?? 0;
    if (status >= 400) {
      log({ iter, surface: "booking.page", severity: "broken", summary: `status=${status}` });
      return;
    }
    // Two <main> nodes (sidebar inset + page main). Use last() for inner content.
    const mainText = (await page.locator("main").last().innerText().catch(() => "")).slice(0, 200);
    const buttons = await page.locator("main").last().locator("button, a").count();
    log({
      iter, surface: "booking.page",
      summary: `status=${status} buttons=${buttons} main-len=${mainText.length}`,
      severity: mainText.length === 0 ? "ugly" : undefined,
    });
  } catch (e) {
    log({ iter, surface: "booking.page", severity: "broken", summary: `exception ${e.message.slice(0, 80)}` });
  } finally {
    await page.close();
  }
}

// =========================================================
// SURFACE 9: /admin/provisioning - admin only
// =========================================================
async function surface9_admin(iter) {
  const { page } = await newProbedPage(ctx);
  try {
    const resp = await page.goto(URL + "/admin/provisioning", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1500);
    const status = resp?.status() ?? 0;
    if (status === 403 || status === 401) {
      log({ iter, surface: "admin.provisioning", summary: `non-admin ${status} - skip` });
      return;
    }
    if (status >= 400) {
      log({ iter, surface: "admin.provisioning", severity: "broken", summary: `status=${status}` });
      return;
    }
    const mainText = (await page.locator("main, body").innerText().catch(() => "")).slice(0, 200);
    log({
      iter, surface: "admin.provisioning",
      summary: `status=${status} body-len=${mainText.length}`,
      severity: mainText.length === 0 ? "ugly" : undefined,
    });
  } catch (e) {
    log({ iter, surface: "admin.provisioning", severity: "broken", summary: `exception ${e.message.slice(0, 80)}` });
  } finally {
    await page.close();
  }
}

import { spawn } from "node:child_process";

let _ctx = ctx;

// Server health probe + reuse session if possible
async function isServerAlive() {
  try {
    const r = await _ctx.request.get(URL + "/api/auth/csrf", { timeout: 4000 });
    return r.ok();
  } catch {
    return false;
  }
}

async function restartServer() {
  console.log("[restart] starting next dev...");
  const p = spawn("node", ["node_modules/.bin/next", "dev", "-p", "3002"], {
    cwd: "/home/pedroafonso/rawclaw-research/rawclaw",
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      NODE_OPTIONS: "--max-old-space-size=3072",
      TURBOPACK_ROOT: "/home/pedroafonso/rawclaw-research/rawclaw",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  p.unref();
  // Give it time to bind
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    if (await isServerAlive()) {
      console.log("[restart] server ready");
      // Re-login: existing ctx will still hold cookie, but routes need to be re-warmed.
      return true;
    }
  }
  return false;
}

async function waitForServer(maxSec = 30) {
  for (let i = 0; i < maxSec; i++) {
    if (await isServerAlive()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  // Try restart
  return await restartServer();
}

// =========================================================
// MAIN LOOP - ITERATIONS iterations across 9 surfaces
// =========================================================
console.log(`\n=== Worker B - ${ITERATIONS} iterations across 9 surfaces ===\n`);
for (let iter = 1; iter <= ITERATIONS; iter++) {
  console.log(`\n--- ITERATION ${iter}/${ITERATIONS} ---`);
  const surfaces = [
    surface1_agents,
    surface1_agents_hire,
    surface2_tasks,
    surface3_routines,
    surface4_skills,
    surface5_company,
    surface6_approvals,
    surface7_minisaas,
    surface8_booking,
    surface9_admin,
  ];
  for (const fn of surfaces) {
    if (!(await isServerAlive())) {
      log({ iter, surface: "_health", severity: "broken", summary: "server down before " + fn.name });
      const ok = await waitForServer(45);
      if (!ok) {
        log({ iter, surface: "_health", severity: "broken", summary: "server stayed dead, abort iter" });
        break;
      }
    }
    try {
      await fn(iter);
    } catch (e) {
      log({ iter, surface: fn.name, severity: "broken", summary: `outer ex ${e.message.slice(0, 80)}` });
    }
  }
}

await ctx.close();
await browser.close();
console.log("\n=== Worker B done ===\n");

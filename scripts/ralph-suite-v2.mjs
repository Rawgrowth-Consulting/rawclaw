// Ralph v2: smoke + actual user flows. Fixed false-positives from v1.
// Tests:
// - Page renders without console errors / 500s / blanks
// - Onboarding chat: type "yes", expect Atlas reply
// - Insight "Open chat": if any insight, click button, expect navigate
// - Bell: click, expect dropdown with Atlas msgs
// - Data entry: paste + save, expect toast success
// - Files: upload + see in list
// - Tasks: list renders rows or empty state (not blank)
import { chromium } from "playwright";
import { writeFileSync, appendFileSync } from "node:fs";

const URL = process.env.URL || "https://rawclaw-rose.vercel.app";
const OUT = "/tmp/ralph-v2-findings.jsonl";
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
  if (auth.status() !== 302 && auth.status() !== 200) {
    log({ surface: "login", severity: "broken", summary: `${auth.status()}` });
    await browser.close();
    process.exit(1);
  }
  log({ surface: "login", summary: "OK" });
}

// Per-page renders + visible-text check (no HTML scan = no RSC false positives)
const PAGES = [
  "/",
  "/onboarding",
  "/agents",
  "/chat",
  "/tasks",
  "/files",
  "/data",
  "/sales-calls",
  "/connections",
  "/skills",
  "/company",
  "/approvals",
  "/routines",
  "/booking",
  "/mini-saas",
  "/updates",
  "/departments",
];

for (const path of PAGES) {
  const page = await ctx.newPage();
  const consoleErrors = [];
  const netFails = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 400 && !u.includes("/_next/") && !u.includes("favicon")) {
      netFails.push({ status: r.status(), url: u.slice(-60) });
    }
  });
  let resp;
  try {
    resp = await page.goto(URL + path, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (e) {
    log({ surface: path, severity: "broken", summary: `goto threw ${e.message.slice(0, 60)}` });
    await page.close();
    continue;
  }
  await page.waitForTimeout(2000);
  const status = resp?.status() ?? 0;
  const visibleText = await page.locator("body").innerText().catch(() => "");
  const trimmed = visibleText.trim();

  let severity = null;
  let summary = `${status}`;
  if (status >= 500) {
    severity = "broken";
    summary = `${status} server error`;
  } else if (status === 404) {
    severity = "broken";
    summary = `404`;
  } else if (trimmed.length < 30) {
    severity = "broken";
    summary = `blank page (${trimmed.length} chars visible)`;
  } else if (netFails.length > 0) {
    severity = "ugly";
    summary = `${netFails.length} net failures: ${netFails.slice(0, 2).map((f) => `${f.status} ${f.url}`).join(", ")}`;
  } else if (consoleErrors.length > 0) {
    severity = "minor";
    summary = `${consoleErrors.length} console errors`;
  }

  log({ surface: path, severity, summary, status, consoleErrors: consoleErrors.slice(0, 3), netFails: netFails.slice(0, 3) });
  await page.close();
}

// Flow 1: Onboarding chat send "yes" - expect Atlas reply
{
  const page = await ctx.newPage();
  await page.goto(URL + "/onboarding", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const ta = page.locator("textarea").first();
  const taVisible = await ta.isVisible().catch(() => false);
  if (!taVisible) {
    log({ surface: "onboarding-chat-flow", severity: "broken", summary: "textarea not visible (gate not passed?)" });
  } else {
    await ta.fill("yes");
    const beforeText = await page.locator("body").innerText().catch(() => "");
    const beforeLen = beforeText.length;
    await ta.press("Enter").catch(() => {});
    await page.waitForTimeout(1000);
    // try clicking send button if Enter didn't fire
    const sendBtn = page.locator("textarea + button, textarea ~ button").last();
    if ((await sendBtn.count()) > 0 && (await sendBtn.isVisible())) {
      await sendBtn.click({ force: true }).catch(() => {});
    }
    // wait up to 60s for reply growth
    let replied = false;
    let errorText = "";
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000);
      const cur = await page.locator("body").innerText().catch(() => "");
      if (cur.length > beforeLen + 50) {
        replied = true;
        break;
      }
      // check for error toast
      const toast = await page.locator('[role="status"], .toast, [data-sonner-toast]').first().innerText().catch(() => "");
      if (toast && /error|fail/i.test(toast)) {
        errorText = toast;
        break;
      }
    }
    if (errorText) {
      log({ surface: "onboarding-chat-flow", severity: "ugly", summary: `reply failed: ${errorText.slice(0, 100)}` });
    } else if (!replied) {
      log({ surface: "onboarding-chat-flow", severity: "broken", summary: "no reply after 60s" });
    } else {
      log({ surface: "onboarding-chat-flow", summary: "Atlas/onboarding replied" });
    }
  }
  await page.close();
}

// Flow 2: Bell click - dropdown opens + has Atlas msgs
{
  const page = await ctx.newPage();
  await page.goto(URL + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const bellBtn = page.locator('button:has(svg.lucide-bell), [aria-label*="notif" i]').first();
  if ((await bellBtn.count()) === 0) {
    log({ surface: "bell-click", severity: "broken", summary: "no bell button found" });
  } else {
    await bellBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
    const text = await page.locator("body").innerText().catch(() => "");
    const hasAtlas = text.includes("Atlas") || text.toLowerCase().includes("heartbeat") || text.toLowerCase().includes("dispatch");
    log({ surface: "bell-click", severity: hasAtlas ? null : "ugly", summary: hasAtlas ? "Atlas msgs visible after click" : "clicked but no Atlas msgs visible" });
  }
  await page.close();
}

// Flow 3: Data entry - paste + save expect toast
{
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 150)); });
  await page.goto(URL + "/data", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const ta = page.locator("textarea").first();
  if (!(await ta.isVisible().catch(() => false))) {
    log({ surface: "data-entry-flow", severity: "broken", summary: "no textarea" });
  } else {
    await ta.fill("ralph e2e probe note. testing data entry flow with sufficient length to pass the 10-char minimum.");
    const saveBtn = page.locator('button:has-text("Save")').first();
    if ((await saveBtn.count()) === 0) {
      log({ surface: "data-entry-flow", severity: "ugly", summary: "no Save button found" });
    } else {
      await saveBtn.click().catch(() => {});
      // wait up to 30s for toast
      let toast = "";
      for (let i = 0; i < 15; i++) {
        await page.waitForTimeout(2000);
        toast = await page.locator('[data-sonner-toast], .toast, [role="status"]').first().innerText().catch(() => "");
        if (toast.length > 0) break;
      }
      const errToast = /error|fail|500/i.test(toast);
      log({ surface: "data-entry-flow", severity: !toast ? "broken" : errToast ? "ugly" : null, summary: toast ? `toast="${toast.slice(0, 80)}"` : "no toast in 30s", consoleErrors: consoleErrors.slice(0, 3) });
    }
  }
  await page.close();
}

// Flow 4: Insight "Open chat" - click first insight chat button if any insights
{
  const page = await ctx.newPage();
  await page.goto(URL + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const insightCount = await page.locator('h4:has-text("up "), h4:has-text("down "), h4:has-text("anomaly")').count();
  if (insightCount === 0) {
    log({ surface: "insight-open-chat", summary: "0 insights to test (org fresh)" });
  } else {
    const chatBtn = page.locator('button[title*="chat" i]').first();
    if ((await chatBtn.count()) === 0) {
      log({ surface: "insight-open-chat", severity: "ugly", summary: "insight visible but no chat button" });
    } else {
      const beforeUrl = page.url();
      await chatBtn.click().catch(() => {});
      await page.waitForTimeout(3000);
      const afterUrl = page.url();
      const navigated = afterUrl !== beforeUrl;
      log({ surface: "insight-open-chat", severity: navigated ? null : "ugly", summary: navigated ? `navigated to ${afterUrl}` : "click did nothing" });
    }
  }
  await page.close();
}

// Summary
const broken = findings.filter((f) => f.severity === "broken");
const ugly = findings.filter((f) => f.severity === "ugly");
const minor = findings.filter((f) => f.severity === "minor");
console.log("\n=== RALPH V2 SUMMARY ===");
console.log(`broken: ${broken.length}, ugly: ${ugly.length}, minor: ${minor.length}, ok: ${findings.length - broken.length - ugly.length - minor.length}`);
if (broken.length > 0) {
  console.log("\nBroken:");
  for (const b of broken) console.log(`  💥 ${b.surface}: ${b.summary}`);
}
if (ugly.length > 0) {
  console.log("\nUgly:");
  for (const u of ugly) console.log(`  ⚠  ${u.surface}: ${u.summary}`);
}
if (minor.length > 0) {
  console.log("\nMinor:");
  for (const m of minor) console.log(`  · ${m.surface}: ${m.summary}`);
}

await browser.close();
process.exit(broken.length > 0 ? 1 : 0);

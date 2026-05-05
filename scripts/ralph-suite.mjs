// Ralph-loop debug suite. Pose as a paying customer, smoke every UI
// surface + API endpoint, capture status / console / network errors.
// Outputs JSONL of findings to /tmp/ralph-findings.jsonl.
import { chromium } from "playwright";
import { writeFileSync, appendFileSync } from "node:fs";

const URL = process.env.URL || "https://rawclaw-rose.vercel.app";
const OUT = "/tmp/ralph-findings.jsonl";
writeFileSync(OUT, ""); // truncate

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});

const consoleErrors = [];
const networkFails = [];
ctx.on("page", (page) => {
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push({ surface: page.url(), text: m.text() });
  });
  page.on("response", (r) => {
    if (r.status() >= 400) networkFails.push({ surface: page.url(), url: r.url(), status: r.status() });
  });
});

const page = await ctx.newPage();

const findings = [];
const log = (entry) => {
  findings.push(entry);
  appendFileSync(OUT, JSON.stringify(entry) + "\n");
  const sev = entry.severity ?? "ok";
  const tag = sev === "broken" ? "💥" : sev === "ugly" ? "⚠ " : sev === "minor" ? "·" : "✓";
  console.log(`${tag} ${entry.surface}: ${entry.summary}`);
};

// ─── Login ──────────────────────────────────────────────
{
  const csrfResp = await ctx.request.get(URL + "/api/auth/csrf");
  const { csrfToken } = await csrfResp.json();
  const auth = await ctx.request.post(URL + "/api/auth/callback/credentials", {
    form: {
      csrfToken,
      email: "pedro-onboard@rawclaw.demo",
      password: "rawclaw-onboard-2026",
      json: "true",
      callbackUrl: URL + "/",
    },
    headers: { "content-type": "application/x-www-form-urlencoded" },
    maxRedirects: 0,
  });
  if (auth.status() !== 302 && auth.status() !== 200) {
    log({ surface: "login", severity: "broken", summary: `auth ${auth.status()}` });
    await browser.close();
    process.exit(1);
  }
  log({ surface: "login", summary: `OK status=${auth.status()}` });
}

const SURFACES = [
  { path: "/", name: "dashboard" },
  { path: "/onboarding", name: "onboarding" },
  { path: "/agents", name: "agents-list" },
  { path: "/chat", name: "chat-hub" },
  { path: "/tasks", name: "tasks" },
  { path: "/files", name: "files" },
  { path: "/data", name: "data-entry" },
  { path: "/sales-calls", name: "sales-calls" },
  { path: "/connections", name: "connections" },
  { path: "/skills", name: "skills" },
  { path: "/company", name: "company" },
  { path: "/approvals", name: "approvals" },
  { path: "/routines", name: "routines" },
  { path: "/booking", name: "booking" },
  { path: "/mini-saas", name: "mini-saas" },
  { path: "/updates", name: "updates" },
  { path: "/departments", name: "departments" },
];

// ─── Visit each page, capture status + render time ─────
for (const s of SURFACES) {
  consoleErrors.length = 0;
  networkFails.length = 0;
  const t0 = Date.now();
  let resp;
  try {
    resp = await page.goto(URL + s.path, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  } catch (e) {
    log({ surface: s.path, severity: "broken", summary: `goto threw: ${e.message.slice(0, 80)}` });
    continue;
  }
  await page.waitForTimeout(1500); // let SWR fetches settle

  const status = resp?.status() ?? 0;
  const elapsed = Date.now() - t0;
  const consoleSnap = [...consoleErrors];
  const netSnap = networkFails.filter((f) => !f.url.includes("/_next/") && !f.url.includes("/favicon"));

  // detect blank / spinner-of-death
  const text = await page.locator("body").innerText().catch(() => "");
  const blank = text.trim().length < 30;
  const hasSpinner = await page.locator(".animate-spin, [data-loading=true]").count();
  const hasError = /error|failed|400|500|404|something went wrong/i.test(text.slice(0, 5000));

  let severity = null;
  let summary = `${status} in ${elapsed}ms`;
  if (status >= 500) {
    severity = "broken";
    summary = `${status} server error in ${elapsed}ms`;
  } else if (status === 404) {
    severity = "broken";
    summary = `404 not found`;
  } else if (status === 0) {
    severity = "broken";
    summary = `no response`;
  } else if (blank) {
    severity = "broken";
    summary = `blank page (text=${text.length} chars)`;
  } else if (netSnap.length > 0) {
    severity = "ugly";
    const detail = netSnap.slice(0, 3).map((n) => `${n.status} ${n.url.split("/").slice(-2).join("/")}`).join(", ");
    summary = `${status} + ${netSnap.length} network failures: ${detail}`;
  } else if (consoleSnap.length > 0) {
    severity = "minor";
    summary = `${status} + ${consoleSnap.length} console errors`;
  } else if (hasError && !s.path.includes("404")) {
    severity = "ugly";
    summary = `${status} but page text contains 'error'`;
  } else if (elapsed > 15_000) {
    severity = "ugly";
    summary = `${status} but slow (${elapsed}ms)`;
  } else if (hasSpinner > 3) {
    severity = "ugly";
    summary = `${status} but ${hasSpinner} spinners stuck`;
  }

  log({
    surface: s.path,
    name: s.name,
    severity,
    summary,
    status,
    elapsed,
    consoleErrors: consoleSnap.slice(0, 5),
    networkFails: netSnap.slice(0, 5),
    blank,
  });
}

// ─── Notification bell ─────────────────────────────────
{
  await page.goto(URL + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const bellCount = await page.locator('[data-notification-bell],[aria-label*="notification" i],button:has(svg.lucide-bell)').count();
  log({ surface: "/bell", severity: bellCount === 0 ? "broken" : null, summary: `${bellCount} bell elements found` });
}

// ─── API endpoint smoke ────────────────────────────────
const ENDPOINTS = [
  "/api/me",
  "/api/notifications/agents",
  "/api/insights",
  "/api/agents",
  "/api/tasks",
  "/api/dashboard/stats",
  "/api/approvals?status=pending",
  "/api/data/recent",
  "/api/mcp-tools",
  "/api/files",
  "/api/routines",
  "/api/skills",
  "/api/company/members",
];

for (const ep of ENDPOINTS) {
  try {
    const r = await ctx.request.get(URL + ep);
    let json = null;
    try { json = await r.json(); } catch {}
    const sev = r.status() >= 500 ? "broken" : r.status() >= 400 ? "ugly" : null;
    log({
      surface: ep,
      severity: sev,
      summary: `${r.status()} ${r.statusText()}`,
      sample: json ? Object.keys(json).slice(0, 5) : null,
    });
  } catch (e) {
    log({ surface: ep, severity: "broken", summary: `threw ${e.message.slice(0, 80)}` });
  }
}

// ─── Final summary ─────────────────────────────────────
const broken = findings.filter((f) => f.severity === "broken");
const ugly = findings.filter((f) => f.severity === "ugly");
const minor = findings.filter((f) => f.severity === "minor");
console.log("\n=== RALPH SUITE SUMMARY ===");
console.log(`broken: ${broken.length}, ugly: ${ugly.length}, minor: ${minor.length}, ok: ${findings.length - broken.length - ugly.length - minor.length}`);
console.log("\nBroken surfaces:");
for (const b of broken) console.log(`  - ${b.surface}: ${b.summary}`);
console.log("\nUgly surfaces:");
for (const u of ugly) console.log(`  - ${u.surface}: ${u.summary}`);

await browser.close();
process.exit(broken.length > 0 ? 1 : 0);

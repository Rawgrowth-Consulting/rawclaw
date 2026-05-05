import { chromium } from "playwright";
const URL = "http://localhost:3002";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();

const csrfResp = await ctx.request.get(URL + "/api/auth/csrf");
const { csrfToken } = await csrfResp.json();
await ctx.request.post(URL + "/api/auth/callback/credentials", {
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

const r = await ctx.request.get(URL + "/api/data/recent");
console.log("recent status:", r.status());
const j = await r.json();
console.log("entries:", j.entries?.length ?? 0);
for (const e of (j.entries ?? []).slice(0, 5)) {
  console.log(`  - [${e.kind}] ${e.label} (${e.source}) ${e.created_at}`);
}

await browser.close();

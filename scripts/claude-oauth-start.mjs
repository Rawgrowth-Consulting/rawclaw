// Trigger Claude Max OAuth start for the test client org and print the URL.
// Pedro opens URL in his browser, copies the code, paste back to /complete.
import { chromium } from "playwright";
const URL = "http://localhost:3002";
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext();
const page = await ctx.newPage();
await page.goto(`${URL}/auth/signin`);
await page.fill("#email", "owner+76897@acmecoach.io");
await page.fill("#password", "demo-pass-12345");
await page.click("button[type=submit]");
await page.waitForURL((u) => !u.toString().includes("/auth/signin"), { timeout: 30000 });
const res = await page.context().request.post(`${URL}/api/connections/claude/oauth/start`, {
  headers: { "content-type": "application/json" },
  data: {},
  timeout: 30000,
});
const body = await res.json();
console.log(JSON.stringify(body, null, 2));
await b.close();

import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * R-MARTI-CANONICAL — first concrete canonical regression spec.
 *
 * Locks the operator-facing shape of Marta's top-reels walk so a
 * future humanizer / SSE / preamble regression flips CI red instead
 * of burning a manual screenshot pass. This is the first of a
 * planned 32+ canonical specs (one per PNG captured during the v3
 * trial).
 *
 * Walk:
 *   1. sign in as pedro@admin (NextAuth credentials POST)
 *   2. open Marta's chat (Research agent in InstaCEO Academy org)
 *   3. send the canonical top-10-reels prompt
 *   4. wait up to 90s for the streamed assistant reply
 *   5. assert the rendered text is operator-clean + lists 10 items
 *
 * Scope: UI-level - we drive the actual chat surface, not the API,
 * because the regressions we want to catch live in the
 * humanizer / SSE-render path that only runs in the browser.
 *
 * Cost: ONE chat round-trip per spec run. Apify cost flows through
 * the real backend (no fixture stub here - we want to catch
 * regressions in the live tool path too).
 *
 * Auth: env-first, with hardcoded fallback so a fresh checkout can
 * still run the scaffold against a seeded dev VPS. Production
 * creds belong in CI secrets, not source.
 *   E2E_USER             - pedro@admin email (default: hardcoded TODO)
 *   E2E_PASS             - pedro@admin password (default: hardcoded TODO)
 *   E2E_MARTA_AGENT_ID   - Marta agent uuid (no fallback - test skips)
 *   E2E_BASE_URL         - target VPS (default: http://127.0.0.1:3002)
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3002";
// TODO(ci): move E2E_USER / E2E_PASS to GitHub secrets before merging
// to v3. Hardcoded values here are placeholders so the scaffold runs
// against a seeded local dev DB. Pedro to confirm real demo creds.
const EMAIL = process.env.E2E_USER ?? "pedro@admin.rawclaw.demo";
const PASSWORD = process.env.E2E_PASS ?? "rawclaw-admin-2026";
const MARTA_AGENT_ID = process.env.E2E_MARTA_AGENT_ID ?? "";

const CANONICAL_PROMPT =
  "top 10 reels from martifox.official by comment count last 30 days. " +
  "numbered list 1-10. each: handle, comment count, first 50 chars of " +
  "caption. no narrative, no preamble.";

// Total walk: sign-in (<5s) + page load (<10s) + assistant stream
// (up to 90s). Leave 30s headroom for slow CI runners.
test.setTimeout(135_000);

async function signInAsAdmin(page: Page): Promise<void> {
  // Direct NextAuth credentials POST. Mirrors the pattern used in
  // tests/onboarding-chat.spec.ts + tests/agent-flows.spec.ts so the
  // session cookie + middleware behave identically.
  const csrfRaw = await page.request.get(`${BASE_URL}/api/auth/csrf`);
  const { csrfToken } = (await csrfRaw.json()) as { csrfToken: string };
  const r = await page.request.post(
    `${BASE_URL}/api/auth/callback/credentials`,
    {
      form: {
        csrfToken,
        email: EMAIL,
        password: PASSWORD,
        json: "true",
        callbackUrl: `${BASE_URL}/agents`,
      },
      headers: { "content-type": "application/x-www-form-urlencoded" },
      maxRedirects: 0,
    },
  );
  expect(
    [200, 302].includes(r.status()),
    `auth POST returned ${r.status()} for ${EMAIL} - check E2E_USER/E2E_PASS`,
  ).toBeTruthy();
}

async function openMartaChat(page: Page): Promise<void> {
  // Task spec says /agents/<marta-id>/chat. The current Next.js
  // router serves the chat tab at /agents/<id> with ?tab=chat (the
  // default). We hit the task-spec URL first; if it 404s the fall-
  // through goes to the canonical query-param form so the scaffold
  // keeps working until/unless a /chat sub-route is added.
  const chatUrl = `${BASE_URL}/agents/${MARTA_AGENT_ID}/chat`;
  const res = await page.goto(chatUrl, { waitUntil: "domcontentloaded" });
  if (!res || res.status() === 404) {
    await page.goto(`${BASE_URL}/agents/${MARTA_AGENT_ID}?tab=chat`, {
      waitUntil: "domcontentloaded",
    });
  }
  // AgentChatTab's composer textarea uses the placeholder
  // "Talk to this agent..." when idle. Wait for it to confirm the
  // chat surface mounted (not the settings tab).
  await expect(page.getByPlaceholder(/Talk to this agent/i)).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("R-MARTI-CANONICAL", () => {
  test.skip(
    !MARTA_AGENT_ID,
    "set E2E_MARTA_AGENT_ID to Marta's uuid before running. " +
      "See tests/canonical/README.md.",
  );

  test("top-10-reels walk renders operator-clean numbered list", async (
    { page },
    testInfo,
  ) => {
    await signInAsAdmin(page);
    await openMartaChat(page);

    // Count the assistant bubbles that already exist (history pre-
    // load) so we can wait for "one more" rather than "any".
    const assistantBubbles = page.locator('[data-role="assistant"]');
    const baseline = await assistantBubbles.count();

    // Type the canonical prompt + send.
    const composer = page.getByPlaceholder(/Talk to this agent/i);
    await composer.fill(CANONICAL_PROMPT);
    await page.getByRole("button", { name: /send message/i }).click();

    // User bubble should appear immediately.
    await expect(
      page.locator('[data-role="user"]', { hasText: CANONICAL_PROMPT.slice(0, 40) }),
    ).toBeVisible({ timeout: 10_000 });

    // Wait for a NEW assistant bubble + for streaming to finish.
    // We poll on bubble count + then on a stable text snapshot so we
    // don't read mid-stream output.
    await expect
      .poll(async () => assistantBubbles.count(), { timeout: 90_000 })
      .toBeGreaterThan(baseline);

    const lastAssistant = assistantBubbles.last();

    // Stream-stability check: same text twice, 1.5s apart.
    let prev = "";
    let stable = "";
    for (let i = 0; i < 30; i++) {
      const now = (await lastAssistant.innerText()).trim();
      if (now && now === prev) {
        stable = now;
        break;
      }
      prev = now;
      await page.waitForTimeout(1_500);
    }
    expect(stable.length, "assistant reply never stabilized in 45s").toBeGreaterThan(0);

    // ---- canonical assertions ----
    // (a) no em-dash in the operator-facing reply
    expect(stable).not.toMatch(/—/);
    // (b) no apify/ literal leak (humanizer should scrub)
    expect(stable.toLowerCase()).not.toContain("apify/");
    // (c) no actor_id literal leak
    expect(stable.toLowerCase()).not.toContain("actor_id");
    // (d) numbered list 1. through 10.
    for (let n = 1; n <= 10; n++) {
      expect(
        stable,
        `expected "${n}." in reply, got first 400 chars: ${stable.slice(0, 400)}`,
      ).toMatch(new RegExp(`(^|\\n|\\s)${n}\\.`));
    }
    // (e) no raw tool-call JSON dict leak
    expect(stable).not.toMatch(/\{["']?tool["']?\s*:/i);

    // ---- screenshot on PASS (failure screenshots come from
    //      playwright.config.ts use.screenshot: only-on-failure) ----
    const runId =
      process.env.GITHUB_RUN_ID ??
      process.env.CI_RUN_ID ??
      String(Date.now());
    const shotPath = path.join(
      testInfo.project.outputDir || "test-results",
      `R-MARTI-CANONICAL-${runId}.png`,
    );
    await page.screenshot({ path: shotPath, fullPage: true });
    testInfo.attachments.push({
      name: `R-MARTI-CANONICAL-${runId}.png`,
      path: shotPath,
      contentType: "image/png",
    });
  });
});

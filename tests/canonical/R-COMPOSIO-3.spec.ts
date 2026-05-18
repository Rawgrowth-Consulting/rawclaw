import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * R-COMPOSIO-3 — Google Calendar event canonical regression spec.
 *
 * Locks Kasia's "create Calendar event" walk. Mirrors
 * R-MARTI-CANONICAL.spec.ts + R-COMPOSIO-1.spec.ts +
 * R-COMPOSIO-2.spec.ts. See tests/canonical/README.md.
 *
 * Walk:
 *   1. sign in as pedro@admin
 *   2. open Kasia's chat
 *   3. send canonical "create calendar event" prompt
 *   4. assert assistant confirms event was created + jargon-free
 *
 * Slug note: Composio's googlecalendar create-event action surfaces
 * as `GOOGLECALENDAR_EVENTS_INSERT` per Google's "events.insert"
 * API verb (NOT _CREATE per D 00:08 research). PR #131's COMPOSIO
 * SLUG DISCOVERY banner forces Kasia to list_tools first; this
 * spec assertion (d) blocks the slug from leaking raw into prose.
 *
 * Auth:
 *   E2E_USER             - pedro@admin email
 *   E2E_PASS             - pedro@admin password
 *   E2E_KASIA_AGENT_ID   - Kasia agent uuid (test skips when unset)
 *   E2E_BASE_URL         - target VPS (default: http://127.0.0.1:3002)
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3002";
const EMAIL = process.env.E2E_USER ?? "pedro@admin.rawclaw.demo";
const PASSWORD = process.env.E2E_PASS ?? "rawclaw-admin-2026";
const KASIA_AGENT_ID = process.env.E2E_KASIA_AGENT_ID ?? "";

const CANONICAL_PROMPT =
  "create a Google Calendar event tomorrow at 10am UTC for " +
  "30 minutes titled 'Marti Dec sync'. Calendar = primary. " +
  "Confirm the event id when done.";

test.setTimeout(135_000);

async function signInAsAdmin(page: Page): Promise<void> {
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

async function openKasiaChat(page: Page): Promise<void> {
  const chatUrl = `${BASE_URL}/agents/${KASIA_AGENT_ID}/chat`;
  const res = await page.goto(chatUrl, { waitUntil: "domcontentloaded" });
  if (!res || res.status() === 404) {
    await page.goto(`${BASE_URL}/agents/${KASIA_AGENT_ID}?tab=chat`, {
      waitUntil: "domcontentloaded",
    });
  }
  await expect(page.getByPlaceholder(/Talk to this agent/i)).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("R-COMPOSIO-3", () => {
  test.skip(
    !KASIA_AGENT_ID,
    "set E2E_KASIA_AGENT_ID to Kasia's uuid before running. " +
      "See tests/canonical/README.md.",
  );

  test("Calendar-event walk produces operator-clean create confirmation", async (
    { page },
    testInfo,
  ) => {
    await signInAsAdmin(page);
    await openKasiaChat(page);

    const assistantBubbles = page.locator('[data-role="assistant"]');
    const baseline = await assistantBubbles.count();

    const composer = page.getByPlaceholder(/Talk to this agent/i);
    await composer.fill(CANONICAL_PROMPT);
    await page.getByRole("button", { name: /send message/i }).click();

    await expect(
      page.locator('[data-role="user"]', {
        hasText: CANONICAL_PROMPT.slice(0, 40),
      }),
    ).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(async () => assistantBubbles.count(), { timeout: 90_000 })
      .toBeGreaterThan(baseline);

    const lastAssistant = assistantBubbles.last();

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
    expect(
      stable.length,
      "assistant reply never stabilized in 45s",
    ).toBeGreaterThan(0);

    // ---- canonical assertions ----
    // (a) no em-dash (humanizer scrub)
    expect(stable).not.toMatch(/—/);
    // (b) event title must appear so operator can verify
    expect(stable).toMatch(/Marti Dec sync/i);
    // (c) create-confirmation language - past-tense per SAY-IT-MEANS-DO-IT
    expect(
      stable.toLowerCase(),
      `expected create confirmation, got: ${stable.slice(0, 400)}`,
    ).toMatch(/\b(event (created|scheduled|added)|created the event|scheduled for|on your calendar)\b/);
    // (d) no Composio jargon leak (raw `composio_use_tool` or
    //     SCREAMING_CASE GOOGLECALENDAR_*_* slug)
    expect(stable.toLowerCase()).not.toContain("composio_use_tool");
    expect(stable.toLowerCase()).not.toMatch(/googlecalendar_[a-z]+_/);
    // (e) no raw tool-call JSON dict leak
    expect(stable).not.toMatch(/\{["']?tool["']?\s*:/i);

    const runId =
      process.env.GITHUB_RUN_ID ??
      process.env.CI_RUN_ID ??
      String(Date.now());
    const shotPath = path.join(
      testInfo.project.outputDir || "test-results",
      `R-COMPOSIO-3-${runId}.png`,
    );
    await page.screenshot({ path: shotPath, fullPage: true });
    testInfo.attachments.push({
      name: `R-COMPOSIO-3-${runId}.png`,
      path: shotPath,
      contentType: "image/png",
    });
  });
});

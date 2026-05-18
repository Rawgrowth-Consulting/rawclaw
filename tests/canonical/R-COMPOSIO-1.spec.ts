import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * R-COMPOSIO-1 — Gmail draft canonical regression spec.
 *
 * Locks the operator-facing shape of Kasia's "save a Gmail draft"
 * walk so a future Composio router / preamble / humanizer regression
 * flips CI red instead of waiting for a manual screenshot pass.
 *
 * Walk:
 *   1. sign in as pedro@admin (NextAuth credentials POST)
 *   2. open Kasia's chat (MARKETING dept-head in InstaCEO Academy org)
 *   3. send the canonical "draft Gmail to chris@" prompt
 *   4. wait up to 90s for the streamed assistant reply
 *   5. assert the rendered text confirms a draft was saved + no
 *      Composio jargon leaks
 *
 * Why Kasia (not EM): the original R-COMPOSIO-1 RETRY-1 used EM but
 * EM hit the "is not Atlas or a department head" gate (preamble:964
 * lie + DB flag). Per [A 23:42] pivot, Kasia (MARKETING dept-head)
 * is the canonical surface for Composio walks. PR #129 (preamble
 * truthful conditional) + the D 03:57 SQL fix on Marti's EM flag
 * cover both regressions.
 *
 * Scope: UI-level - the regressions that matter (Composio slug
 * SCREAMING_CASE-vs-natural-lang per PR #131, BUG-9 silent-stuck
 * post-tool per PRs #126 + #127) only surface in the browser path.
 *
 * Cost: ONE chat round-trip + ONE Composio Gmail draft creation.
 * Verifies on the chat surface only; the second mail.google.com/
 * drafts verification PNG is captured manually by A and saved to
 * canonical/R-COMPOSIO-1-gmail-verify.png.
 *
 * Auth: env-first, with the same hardcoded fallback as
 * R-MARTI-CANONICAL.spec.ts. Production creds belong in CI secrets.
 *   E2E_USER             - pedro@admin email
 *   E2E_PASS             - pedro@admin password
 *   E2E_KASIA_AGENT_ID   - Kasia agent uuid (no fallback - test skips)
 *   E2E_BASE_URL         - target VPS (default: http://127.0.0.1:3002)
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3002";
const EMAIL = process.env.E2E_USER ?? "pedro@admin.rawclaw.demo";
const PASSWORD = process.env.E2E_PASS ?? "rawclaw-admin-2026";
const KASIA_AGENT_ID = process.env.E2E_KASIA_AGENT_ID ?? "";

// Canonical prompt verbatim from [D 04:24 P4 dispatch] - keep the
// natural-language phrasing so PR #131's COMPOSIO SLUG DISCOVERY
// banner gets exercised (Kasia must list_tools first to find the
// "save a Gmail draft" natural-lang slug, NOT guess GMAIL_CREATE_DRAFT).
const CANONICAL_PROMPT =
  "draft a Gmail to chris@rawgrowth.ai with subject " +
  "\"Marti Dec launch top 10 reels\" and a body summarising the " +
  "6 reels we found today. Do NOT send - draft only.";

// Total walk: sign-in (<5s) + page load (<10s) + Composio list_tools
// discovery + draft creation (~30s) + assistant stream (~30s).
// Leave headroom for slow CI runners.
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

test.describe("R-COMPOSIO-1", () => {
  test.skip(
    !KASIA_AGENT_ID,
    "set E2E_KASIA_AGENT_ID to Kasia's uuid before running. " +
      "See tests/canonical/README.md.",
  );

  test("Gmail-draft walk produces operator-clean confirmation reply", async (
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
    expect(
      stable.length,
      "assistant reply never stabilized in 45s",
    ).toBeGreaterThan(0);

    // ---- canonical assertions ----
    // (a) no em-dash in operator-facing reply
    expect(stable).not.toMatch(/—/);
    // (b) confirmation language: agent must acknowledge the draft
    //     was created. Accept English variants ("saved a draft",
    //     "drafted", "draft is saved", "draft ready") and the
    //     past-tense voice that maps to SAY-IT-MEANS-DO-IT.
    expect(
      stable.toLowerCase(),
      `expected draft-saved confirmation, got: ${stable.slice(0, 400)}`,
    ).toMatch(/\b(draft (saved|created|ready)|saved (a |the )?draft|drafted)\b/);
    // (c) recipient must be mentioned so the operator can verify
    //     the right address landed in the draft.
    expect(stable).toMatch(/chris@rawgrowth\.ai/);
    // (d) no Composio jargon leak (humanizer must scrub the
    //     SCREAMING_CASE slug or the natural-lang slug raw).
    expect(stable.toLowerCase()).not.toContain("composio_use_tool");
    expect(stable.toLowerCase()).not.toMatch(/gmail_(create|send)_/);
    // (e) no raw tool-call JSON dict leak.
    expect(stable).not.toMatch(/\{["']?tool["']?\s*:/i);
    // (f) MUST NOT have actually SENT the email - per Pedro security
    //     mandate ("TU PODE MEXER, SÓ NN ENVIAR NADA"), draft only.
    //     A reply that says "sent" instead of "drafted" is a fail.
    expect(stable.toLowerCase()).not.toMatch(/\b(email sent|sent the email|message sent)\b/);

    // ---- screenshot on PASS ----
    const runId =
      process.env.GITHUB_RUN_ID ??
      process.env.CI_RUN_ID ??
      String(Date.now());
    const shotPath = path.join(
      testInfo.project.outputDir || "test-results",
      `R-COMPOSIO-1-${runId}.png`,
    );
    await page.screenshot({ path: shotPath, fullPage: true });
    testInfo.attachments.push({
      name: `R-COMPOSIO-1-${runId}.png`,
      path: shotPath,
      contentType: "image/png",
    });
  });
});

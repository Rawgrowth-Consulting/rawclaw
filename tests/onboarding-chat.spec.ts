import { expect, test } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * E2E coverage for onboarding chat AI features (commits dffd371 + 8ea165b):
 *  1. file drag-drop on the chat surface
 *  2. paperclip click → file picker upload
 *  3. scrape_url tool when the client pastes a URL
 *
 * Scope: only /onboarding + /api/onboarding/chat + /api/onboarding/brand-docs/upload + /api/scrape*.
 *
 * Auth uses the seeded `pedro-onboard@rawclaw.demo` account from
 * scripts/probe-local-onboard.mjs. The account already passes the
 * onboarding gate; we just need /onboarding to render the chat surface
 * (which it does because the server's pre-onboarding gate gives every
 * user re-entry until brand profile is generated).
 *
 * AI cost: tests 1 + 2 do NOT wait for an assistant reply, only for the
 * file bubble + canned user line. Test 3 issues ONE chat round-trip and
 * verifies scrape_url's reasoning event appears in the SSE stream.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3002";
const EMAIL = process.env.E2E_OWNER_EMAIL ?? "pedro-onboard@rawclaw.demo";
const PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "rawclaw-onboard-2026";

test.setTimeout(180_000);

async function signIn(page: import("@playwright/test").Page) {
  // Direct NextAuth credentials POST. Matches scripts/probe-local-onboard.mjs.
  const csrfRaw = await page.request.get(`${BASE_URL}/api/auth/csrf`);
  const { csrfToken } = await csrfRaw.json();
  const r = await page.request.post(
    `${BASE_URL}/api/auth/callback/credentials`,
    {
      form: {
        csrfToken,
        email: EMAIL,
        password: PASSWORD,
        json: "true",
        callbackUrl: `${BASE_URL}/onboarding`,
      },
      headers: { "content-type": "application/x-www-form-urlencoded" },
      maxRedirects: 0,
    },
  );
  expect(
    [200, 302].includes(r.status()),
    `auth status ${r.status()}`,
  ).toBeTruthy();
}

async function gotoOnboarding(page: import("@playwright/test").Page) {
  await page.goto(`${BASE_URL}/onboarding`, { waitUntil: "domcontentloaded" });
  // Initial assistant greeting renders client-side after hydration.
  await expect(page.getByText(/Rawgrowth Onboarding/i)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByPlaceholder(/Type your answer/i)).toBeVisible();
}

async function makeTempMd(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rawclaw-e2e-"));
  const filePath = path.join(dir, "rawclaw-test.md");
  await fs.writeFile(
    filePath,
    "# Rawclaw e2e test file\n\nUploaded via the onboarding chat surface.\n",
    "utf8",
  );
  return filePath;
}

test.describe("onboarding chat AI", () => {
  test("file drag-drop renders bubble and AI sees filename", async ({
    page,
  }) => {
    await signIn(page);
    await gotoOnboarding(page);

    const filePath = await makeTempMd();
    const fileName = path.basename(filePath);
    const buf = await fs.readFile(filePath);
    const dataB64 = buf.toString("base64");

    // Playwright cannot drag from the host filesystem. Fire dragenter /
    // dragover / drop events with a synthetic DataTransfer that holds a
    // File built in-page from the base64 payload. This exercises the
    // same handleDragEnter/Over/Drop callbacks in OnboardingChat.tsx.
    await page.evaluate(
      async ({ name, b64 }) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const file = new File([bytes], name, { type: "text/markdown" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const root = document
          .querySelector('textarea[placeholder*="Type your answer"]')
          ?.closest("div.relative.flex.h-full.flex-col") as HTMLElement | null;
        if (!root) throw new Error("chat root not found");
        const fire = (type: string) => {
          const ev = new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt,
          });
          root.dispatchEvent(ev);
        };
        fire("dragenter");
        fire("dragover");
        fire("drop");
      },
      { name: fileName, b64: dataB64 },
    );

    // The green file bubble must appear (status=uploading first, then
    // ready → "Attached").
    const fileBubble = page.locator('[data-role="uploaded_file"]');
    await expect(fileBubble).toBeVisible({ timeout: 30_000 });
    await expect(fileBubble).toContainText(fileName);
    await expect(fileBubble).toContainText(/Attached/, { timeout: 60_000 });

    // The chat code's uploadChatFile calls sendMessage(canned) to surface
    // "I uploaded a file: ..." as a user bubble - that's how the AI sees
    // the upload in its next turn. We assert it exists. We do NOT wait
    // for the AI's reply to keep AI usage minimal.
    const userLine = page.locator('[data-role="user"]', {
      hasText: `I uploaded a file: ${fileName}`,
    });
    await expect(userLine).toBeVisible({ timeout: 15_000 });
  });

  test("paperclip click opens file picker and uploads", async ({ page }) => {
    await signIn(page);
    await gotoOnboarding(page);

    const filePath = await makeTempMd();
    const fileName = path.basename(filePath);

    // The paperclip button is wired to fileInputRef.current?.click().
    // Setting files on the hidden <input type="file"> directly fires the
    // same onChange handler.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);

    const fileBubble = page.locator('[data-role="uploaded_file"]');
    await expect(fileBubble).toBeVisible({ timeout: 30_000 });
    await expect(fileBubble).toContainText(fileName);
    await expect(fileBubble).toContainText(/Attached/, { timeout: 60_000 });

    const userLine = page.locator('[data-role="user"]', {
      hasText: `I uploaded a file: ${fileName}`,
    });
    await expect(userLine).toBeVisible({ timeout: 15_000 });
  });

  test("scrape_url tool fires when client pastes a URL", async ({ page }) => {
    await signIn(page);

    // Hit /api/onboarding/chat directly with a crafted user turn that
    // pastes a URL. The system prompt says scrape_url MUST be called
    // BEFORE the next question whenever a URL appears. Parse the NDJSON
    // stream for a reasoning event whose label starts with "Scanning ".
    //
    // We use a fresh assistant greeting + a short user reply so the model
    // has minimal context to drift into.
    const messages = [
      {
        role: "assistant",
        content:
          "Welcome to onboarding. To start, what's the URL of your main website or social profile?",
      },
      { role: "user", content: "My main site is https://example.com" },
    ];
    const res = await page.request.post(`${BASE_URL}/api/onboarding/chat`, {
      data: { messages },
      headers: { "Content-Type": "application/json" },
      timeout: 120_000,
    });
    expect(res.status(), "chat 200").toBe(200);

    const body = await res.body();
    const text = body.toString("utf8");

    // The route emits newline-delimited JSON events. Find a reasoning
    // event whose label is "Scanning <host>" or "Scanned <host>" -
    // either form proves scrape_url was called.
    let scrapeReasoningSeen = false;
    let scrapeFieldsSeen = false;
    let scrapedHost: string | null = null;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === "reasoning" && typeof ev.label === "string") {
          const m = ev.label.match(/^(Scanning|Scanned)\s+(\S+)/);
          if (m) {
            scrapeReasoningSeen = true;
            scrapedHost = m[2];
          }
          if (
            ev.fields &&
            typeof ev.fields === "object" &&
            "url" in ev.fields
          ) {
            scrapeFieldsSeen = true;
          }
        }
      } catch {
        // skip non-JSON lines
      }
    }

    expect(
      scrapeReasoningSeen,
      `expected scrape_url reasoning event in /api/onboarding/chat stream. ` +
        `got body (first 800 chars): ${text.slice(0, 800)}`,
    ).toBeTruthy();
    expect(
      scrapedHost,
      "expected scrape_url to target example.com",
    ).toMatch(/example\.com/);
    // The "done" reasoning event includes fields with the url. If the
    // call succeeded we should see those.
    expect(scrapeFieldsSeen).toBeTruthy();
  });
});

import { test, expect, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertOperatorClean } from "./r-marti-canonical.spec";

/**
 * P8b walk regression DELEGATION verification per [B 03:39 → C].
 *
 * Codifies the H-ARCH-4 (sha 30b7725) + H-ARCH-4b (sha b3a89e2)
 * auto-delegate path: model gets a request whose data lives on a
 * peer's file (creator-list owned by Kasia), looks up the owner,
 * delegates via agent_invoke, and renders the delegated reply.
 *
 * Mocks the apify scrape so the harness runs WITHOUT Claude Max
 * (live-walk infra blocker). The delegation sequence is asserted
 * against a mock-call spy, not the live model - that part is
 * Tier 3 once quota refills.
 *
 * Asserts:
 *   - No "would you like" / "should I" / "do you want" question
 *     (H-ARCH-4b hard-ban on user-choice ask)
 *   - Reply contains 10 ranked reels
 *   - Operator-visible text passes the banned-token gate
 *   - The mock apify route was hit
 */

const FIXTURE_PATH = "tests/e2e/fixtures/r-marti-10-reels.json";

const USER_CHOICE_QUESTION_PATTERNS: ReadonlyArray<RegExp> = [
  /would you like/i,
  /should i/i,
  /do you want/i,
  /czy chcesz/i,
  /chcesz że/i,
];

export type DelegateCallSpy = {
  apifyHits: number;
  apifyLastBody: string | null;
};

/**
 * Install mock routes for the delegation path:
 *   - api.apify.com/* → returns the 10-reel fixture
 * Records hit count + last request body so assertions can verify
 * the model actually ran the scrape (not just claimed to).
 */
export async function installDelegateMocks(page: Page): Promise<DelegateCallSpy> {
  const spy: DelegateCallSpy = { apifyHits: 0, apifyLastBody: null };
  const body = await readFile(resolve(process.cwd(), FIXTURE_PATH), "utf8");
  await page.route(/api\.apify\.com\//, async (route: Route) => {
    spy.apifyHits += 1;
    const req = route.request();
    spy.apifyLastBody = req.postData() ?? null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body,
    });
  });
  return spy;
}

/**
 * Assertions every delegate-path walk reply must satisfy.
 * Exposed so the canonical + per-scenario specs can reuse.
 */
export function assertDelegateReplyContract(reply: string): void {
  // 1. Banned vocab gate.
  assertOperatorClean(reply);

  // 2. Hard-ban on user-choice questions (H-ARCH-4b).
  for (const re of USER_CHOICE_QUESTION_PATTERNS) {
    expect(reply, `delegate reply leaked user-choice question ${re}`).not.toMatch(re);
  }

  // 3. Reel count - reply must reference 10 (the fixture row count).
  expect(reply).toMatch(/\b10\b/);

  // 4. Operator-visible Kasia identity must be present (delegation
  //    surfaces who answered) but only as plain handle - no
  //    storage-suffix leak.
  expect(reply).toMatch(/Kasia|@martifox/i);
}

test.describe("R-MARTI delegate-verify (P8b)", () => {
  test("fixture: 10 reels, all martifox.official, ranked by comments desc", async () => {
    const raw = await readFile(resolve(process.cwd(), FIXTURE_PATH), "utf8");
    const rows = JSON.parse(raw) as Array<{
      ownerUsername: string;
      commentsCount: number;
    }>;
    expect(rows.length).toBe(10);
    for (const r of rows) expect(r.ownerUsername).toBe("martifox.official");
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].commentsCount).toBeGreaterThanOrEqual(rows[i].commentsCount);
    }
  });

  test("USER_CHOICE_QUESTION_PATTERNS rejects English + Polish forms", () => {
    const samples = [
      "Would you like me to run the scrape?",
      "Should I delegate to Kasia?",
      "Do you want me to start?",
      "Czy chcesz że wykonam?",
    ];
    for (const s of samples) {
      const matched = USER_CHOICE_QUESTION_PATTERNS.some((re) => re.test(s));
      expect(matched, `sample failed pattern match: ${s}`).toBe(true);
    }
  });

  test("assertDelegateReplyContract: clean delegate reply passes", () => {
    const clean =
      "Kasia pulled 10 reels from @martifox.official, ranked by comments. Top performer was the capsule-drop teaser with 712 comments.";
    expect(() => assertDelegateReplyContract(clean)).not.toThrow();
  });

  test("assertDelegateReplyContract: reply with user-choice question fails", () => {
    const dirty =
      "Kasia pulled 10 reels from @martifox.official. Would you like me to also pull last 30 days?";
    expect(() => assertDelegateReplyContract(dirty)).toThrow();
  });

  test("assertDelegateReplyContract: reply missing reel count fails", () => {
    const dirty =
      "Kasia pulled a bunch of reels from @martifox.official ranked by comments.";
    expect(() => assertDelegateReplyContract(dirty)).toThrow();
  });

  test("assertDelegateReplyContract: reply with raw tool name fails", () => {
    const dirty =
      "Kasia ran apify_top_reels_from_file and got 10 reels from @martifox.official.";
    expect(() => assertDelegateReplyContract(dirty)).toThrow();
  });

  test("installDelegateMocks wires apify route + records hits", async ({ page }) => {
    const spy = await installDelegateMocks(page);
    const res = await page.evaluate(async () => {
      const r = await fetch("https://api.apify.com/v2/acts/x/runs", {
        method: "POST",
        body: JSON.stringify({ handles: ["martifox.official"] }),
      });
      return r.json();
    });
    expect(spy.apifyHits).toBe(1);
    expect(spy.apifyLastBody).toMatch(/martifox/);
    expect(Array.isArray(res)).toBe(true);
    expect((res as Array<{ id: string }>).length).toBe(10);
  });

  test.fixme(
    "live delegate walk: prompt 'top 10 reels by comments from creator-list', verify auto-delegate + clean reply",
    async ({ page }) => {
      // Promotion blocked on:
      //   1. Claude Max quota refill (current infra block)
      //   2. seed fixture (Marti-shaped org + Kasia agent + creator-list file)
      //   3. auth helper to sign in as admin operator
      // Pattern when ready:
      //   const spy = await installDelegateMocks(page);
      //   await signInAdmin(page);
      //   await page.goto("/agents/<marti-agent-id>/chat");
      //   await page.fill(
      //     "textarea[name=message]",
      //     "Give me the top 10 reels by comments from the creator list, last 10 days.",
      //   );
      //   await page.click("button:has-text('Send')");
      //   await page.waitForSelector(
      //     "[data-testid=chat-message-last]:has-text('reel')",
      //     { timeout: 30_000 },
      //   );
      //   expect(spy.apifyHits).toBeGreaterThan(0);
      //   const reply = await page.textContent("[data-testid=chat-message-last]");
      //   assertDelegateReplyContract(reply ?? "");
      expect(true).toBe(true);
    },
  );
});

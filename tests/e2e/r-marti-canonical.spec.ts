import { test, expect, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * P3 walk regression scaffold per [B 02:33 + B 02:48 → C].
 *
 * Goal: lock the R-MARTI-CANONICAL walk shape so a future
 * humanizer / preamble / SSE regression flips CI red instead of
 * burning a 10-minute manual screenshot pass. Asserts:
 *
 *  1. operator-visible reply contains zero banned vocabulary
 *     (tool names, Pedro, FLEX MODE, shared memory, CLAUDE.md,
 *     proper-noun + storage suffix, file_name variable leak)
 *  2. Apify scrape returned a reel list (mocked from fixture) +
 *     the operator-facing summary mentions handle + counts
 *  3. spinner copy starts as "Working on it..." and never shows
 *     the raw underscore tool name
 *
 * v1 scaffold: only the jargon assertion harness + apify mock
 * are exercised. The actual chat-page UI walk is left as
 * `test.fixme()` because it needs a seeded org + agent + bot
 * connection - that fixture lives in tests/agent-flows.spec.ts
 * but is bound to dogfood data, not Marti. Pedro / B can promote
 * the fixme to a real test once a Marti-shaped seed fixture
 * exists.
 *
 * Run against local dev server only: do NOT point E2E_BASE_URL
 * at Marti production - this suite mutates chat history.
 */

const BANNED_OPERATOR_TOKENS: ReadonlyArray<RegExp> = [
  /\bPedro\b/,
  /\bFLEX MODE\b/i,
  /\bshared memory\b/i,
  /\bCLAUDE\.md\b/i,
  /\bscan_agent\.yaml\b/i,
  /\bscan__CLAUDE\.md\b/i,
  /\bagents_update\b/i,
  /\bagents_create\b/i,
  /\bagents_fire\b/i,
  /\bagent_invoke\b/i,
  /\bagent_message\b/i,
  /\bcomposio_use_tool\b/i,
  /\bcomposio_list_tools\b/i,
  /\bapify_top_reels_from_file\b/i,
  /\bapify_run_actor\b/i,
  /\bapify_batch_scrape\b/i,
  /\bapify_race_scrape\b/i,
  /\bapify_poll_run\b/i,
  /\bapify_start_run\b/i,
  /\bknowledge_query\b/i,
  /\blookup_my_files\b/i,
  /\blookup_brand_voice\b/i,
  /\bGMAIL_CREATE_EMAIL_DRAFT\b/i,
  /\bGMAIL_SEND_EMAIL\b/i,
  /\bGOOGLECALENDAR_CREATE_EVENT\b/i,
  /\bSLACK_SEND_MESSAGE\b/i,
  /\bMCP\b/,
  /\btool_call\b/,
  /\bsystem_prompt\b/,
  /\bcoercion error\b/i,
  /\btype mismatch\b/i,
  /\bcommand structure\b/i,
  /\bcommand type wrapper\b/i,
  /\bfile_name\b/,
  // Kasia/Marti/etc + possessive storage suffix per H-ARCH-2g
  /\b(Kasia|Marti|Atlas|Scan|Zosia|Anya)(?:'s)? (?:files|folder|data|tasks|memory|notes|content|stuff)\b/i,
];

export function assertOperatorClean(text: string): void {
  for (const re of BANNED_OPERATOR_TOKENS) {
    expect(text, `banned token matched by ${re}`).not.toMatch(re);
  }
}

/**
 * Stub api.apify.com requests with the canonical reel fixture so
 * the test runs without an Apify API key and with deterministic
 * payload. Caller passes the live Page instance.
 */
export async function stubApifyReels(page: Page): Promise<void> {
  const fixturePath = resolve(
    process.cwd(),
    "tests/e2e/fixtures/marti-canonical-reels.json",
  );
  const fixture = await readFile(fixturePath, "utf8");

  await page.route(/api\.apify\.com\//, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: fixture,
    });
  });
}

test.describe("R-MARTI-CANONICAL walk regression", () => {
  test("BANNED_OPERATOR_TOKENS list is non-empty + every entry compiles", () => {
    expect(BANNED_OPERATOR_TOKENS.length).toBeGreaterThan(20);
    for (const re of BANNED_OPERATOR_TOKENS) {
      expect(re).toBeInstanceOf(RegExp);
      // Smoke: every regex tests cleanly against an empty string
      // (would throw on a malformed pattern at load time).
      expect(re.test("")).toBe(false);
    }
  });

  test("assertOperatorClean rejects a leaky sample", () => {
    expect(() =>
      assertOperatorClean("I will fire agents_update on Pedro now"),
    ).toThrow();
  });

  test("assertOperatorClean accepts a clean sample", () => {
    expect(() =>
      assertOperatorClean(
        "Pulled the latest 3 reels from the creator list - top performer by comments was the Friday-vibes post.",
      ),
    ).not.toThrow();
  });

  test("apify fixture file parses + has expected shape", async () => {
    const fixturePath = resolve(
      process.cwd(),
      "tests/e2e/fixtures/marti-canonical-reels.json",
    );
    const raw = await readFile(fixturePath, "utf8");
    const parsed = JSON.parse(raw) as Array<{
      id: string;
      ownerUsername: string;
      commentsCount: number;
    }>;
    expect(parsed.length).toBeGreaterThanOrEqual(3);
    for (const row of parsed) {
      expect(row.id).toMatch(/^C-MARTI/);
      expect(row.ownerUsername).toBe("martifox.official");
      expect(typeof row.commentsCount).toBe("number");
    }
  });

  test.fixme(
    "live walk: signs in as admin, opens Marti chat, fires canonical prompt, asserts reply is operator-clean + lists 3 reels",
    async ({ page }) => {
      // Promotion blocked on a Marti-shaped seed fixture + auth helper.
      // Pattern when ready:
      //   await stubApifyReels(page);
      //   await signInAdmin(page);
      //   await page.goto("/agents/<seeded-marti-agent-uuid>/chat");
      //   await page.fill(
      //     "textarea[name=message]",
      //     "Pull the top 3 reels from the creator list by comments, last 10 days.",
      //   );
      //   await page.click("button:has-text('Send')");
      //   await page.waitForSelector(
      //     "[data-testid=chat-message-last]:has-text('martifox.official')",
      //     { timeout: 30_000 },
      //   );
      //   const reply = await page.textContent(
      //     "[data-testid=chat-message-last]",
      //   );
      //   assertOperatorClean(reply ?? "");
      //   expect(reply).toMatch(/3\s+reel/i);
      //   const spinner = await page.textContent(
      //     "[data-testid=chat-spinner-last]",
      //   );
      //   assertOperatorClean(spinner ?? "");
      expect(true).toBe(true); // placeholder to satisfy fixme contract
    },
  );

  test.fixme("live walk: R-ORCH-1 CEO delegates to dept-head", async () => {
    // Promotion blocked on seed fixture. Pattern mirrors R-MARTI-
    // CANONICAL but routes through delegate path. Same
    // assertOperatorClean gate applies.
    expect(true).toBe(true);
  });

  test.fixme(
    "live walk: R-COMPOSIO Gmail real draft + operator-clean confirmation",
    async () => {
      // Promotion blocked on Composio sandbox account.
      expect(true).toBe(true);
    },
  );
});

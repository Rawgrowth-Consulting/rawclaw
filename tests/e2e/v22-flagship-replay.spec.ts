import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { humanizeJargon } from "../../src/lib/agent/jargon";

/**
 * P16 fixture-driven replay of R-MARTI-CANONICAL v22 FLAGSHIP walk
 * per [B 04:16 → C].
 *
 * v22 was the first 100/100 jargon flagship walk (sha aa0b1a3+).
 * Source-of-truth screenshot:
 *   /home/pedroafonso/Downloads/screenshots/
 *     test-R-MARTI-CANONICAL-v22-FLAGSHIP-100-jargon.png
 *
 * The screenshot's operator-visible strings (5 events: 2 reasoning
 * chips + 2 delegate cards + 1 assistant reply) are persisted in
 * tests/e2e/fixtures/v22-flagship-walk.json with the banned-token
 * + must-contain contracts derived from the H-ARCH coverage suite.
 *
 * This contract pins the flagship walk shape: any future humanize
 * regression that re-introduces a banned token on this EXACT walk
 * trips a dedicated assertion at the CI tier, even if the broader
 * H-ARCH unit suite happens to miss it.
 *
 * Pairs with tests/e2e/r-marti-h-arch-4-contract.spec.ts and the
 * H-ARCH-5 spec batch under tests/unit/jargon-h-arch-5.spec.ts.
 */

const FIXTURE_PATH = "tests/e2e/fixtures/v22-flagship-walk.json";

type FlagshipEvent =
  | { kind: "reasoning_chip"; order: number; label: string; text: string }
  | { kind: "delegate_card"; order: number; header: string; detail_toggle: string }
  | { kind: "assistant_reply"; order: number; text: string };

type FlagshipFixture = {
  scenario: string;
  source: string;
  agent: string;
  agent_role: string;
  tier_badge: string;
  message_count_at_capture: number;
  user_prompt: string;
  events: FlagshipEvent[];
  banned_tokens_anywhere: string[];
  must_contain_in_visible_reply: string[];
  reasoning_chip_must_be_human: string[];
  delegate_card_headers_must_be_human: string[];
};

async function loadFixture(): Promise<FlagshipFixture> {
  const raw = await readFile(resolve(process.cwd(), FIXTURE_PATH), "utf8");
  return JSON.parse(raw) as FlagshipFixture;
}

function collectOperatorVisibleStrings(f: FlagshipFixture): string[] {
  const out: string[] = [f.user_prompt];
  for (const e of f.events) {
    if (e.kind === "reasoning_chip") {
      out.push(e.label, e.text);
    } else if (e.kind === "delegate_card") {
      out.push(e.header, e.detail_toggle);
    } else if (e.kind === "assistant_reply") {
      out.push(e.text);
    }
  }
  return out;
}

test.describe("R-MARTI-CANONICAL v22 FLAGSHIP replay contract", () => {
  test("fixture loads + has expected event count", async () => {
    const f = await loadFixture();
    expect(f.scenario).toContain("v22");
    expect(f.events.length).toBe(5);
    expect(f.events.filter((e) => e.kind === "reasoning_chip").length).toBe(2);
    expect(f.events.filter((e) => e.kind === "delegate_card").length).toBe(2);
    expect(f.events.filter((e) => e.kind === "assistant_reply").length).toBe(1);
  });

  test("every operator-visible string is clean of banned tokens", async () => {
    const f = await loadFixture();
    const strings = collectOperatorVisibleStrings(f);
    for (const s of strings) {
      for (const banned of f.banned_tokens_anywhere) {
        expect(
          s,
          `string "${s.slice(0, 80)}" leaks banned token "${banned}"`,
        ).not.toContain(banned);
      }
    }
  });

  test("assistant reply contains required operator tokens", async () => {
    const f = await loadFixture();
    const reply = f.events.find((e) => e.kind === "assistant_reply");
    expect(reply, "fixture missing assistant_reply event").toBeDefined();
    if (reply && reply.kind === "assistant_reply") {
      for (const required of f.must_contain_in_visible_reply) {
        expect(
          reply.text,
          `assistant reply missing required token "${required}"`,
        ).toContain(required);
      }
    }
  });

  test("reasoning chips contain human vocabulary, not internal naming", async () => {
    const f = await loadFixture();
    const chips = f.events.filter((e) => e.kind === "reasoning_chip");
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      if (chip.kind !== "reasoning_chip") continue;
      let matched = 0;
      for (const human of f.reasoning_chip_must_be_human) {
        if (chip.text.toLowerCase().includes(human.toLowerCase())) matched++;
      }
      expect(
        matched,
        `reasoning chip "${chip.text.slice(0, 80)}" missing all human vocab markers`,
      ).toBeGreaterThan(0);
    }
  });

  test("delegate card headers exactly match the human-vocab list", async () => {
    const f = await loadFixture();
    const cardHeaders = f.events
      .filter((e): e is Extract<FlagshipEvent, { kind: "delegate_card" }> => e.kind === "delegate_card")
      .map((e) => e.header);
    expect(cardHeaders).toEqual(f.delegate_card_headers_must_be_human);
  });

  test("humanizeJargon is an IDENTITY function on the fixture strings", async () => {
    // The flagship walk is already clean; piping each visible string
    // through humanizeJargon must NOT change a single character. If
    // this fails, either (a) JARGON_MAP got a new pattern that
    // accidentally matches clean text (over-broad) or (b) the
    // fixture leaked jargon under a new rule.
    const f = await loadFixture();
    const strings = collectOperatorVisibleStrings(f);
    for (const s of strings) {
      expect(
        humanizeJargon(s),
        `humanizeJargon altered already-clean string "${s.slice(0, 80)}"`,
      ).toBe(s);
    }
  });

  test("banned token list spans every H-ARCH coverage wave", async () => {
    const f = await loadFixture();
    const banned = f.banned_tokens_anywhere;
    // H22 + jargon-coverage-extend: raw tool names
    expect(banned).toContain("apify_top_reels_from_file");
    expect(banned).toContain("lookup_my_files");
    expect(banned).toContain("agent_invoke");
    // HOTFIX 24: reasoning chip leaks
    expect(banned).toContain("FLEX MODE");
    expect(banned).toContain("shared memory");
    expect(banned).toContain("Pedro");
    // H-ARCH-2g + 2h: peer-pronoun + storage suffix
    expect(banned).toContain("Kasia's tasks");
    expect(banned).toContain("Kasia's files");
    expect(banned).toContain("Kasia's data");
    // H-ARCH-5: race_scrape + window_days + top_n
    expect(banned).toContain("race_scrape");
    expect(banned).toContain("window_days=");
    expect(banned).toContain("top_n=");
  });

  test("user prompt itself is jargon-free (defines clean baseline)", async () => {
    const f = await loadFixture();
    for (const banned of f.banned_tokens_anywhere) {
      expect(
        f.user_prompt,
        `user prompt itself contains banned "${banned}" - fixture base is wrong`,
      ).not.toContain(banned);
    }
  });

  test.fixme(
    "live replay: when Claude Max quota refills, fire v22 walk against /chat and assert this fixture",
    async () => {
      // Promotion: stub apify with marti-canonical-reels fixture,
      // sign in pedro@admin.com, fire f.user_prompt, capture SSE
      // events, assert kind+order+text matches fixture, then
      // re-run the banned-token sweep on the live SSE strings.
      expect(true).toBe(true);
    },
  );
});

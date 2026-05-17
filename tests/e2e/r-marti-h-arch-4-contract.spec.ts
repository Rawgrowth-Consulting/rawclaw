import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * P7 fixture-driven contract test per [B 03:25 → C].
 *
 * H-ARCH-4 ships the FILENAME-RESOLVE rule (sha 30b7725) +
 * H-ARCH-4b hard-bans user-choice asks (sha b3a89e2). Live walk
 * verification is blocked on Claude Max quota; this fixture-
 * driven contract proves the OPERATOR-FACING behavior assertion
 * (banned-token list + must-contain list) is what we want,
 * INDEPENDENT of model availability.
 *
 * When the live walk reactivates, the same fixture drives the
 * tier-3 stub - the assertion harness already matches.
 *
 * tests/e2e/fixtures/r-marti-h-arch-4-delegated-reply.json is
 * the source of truth for:
 *   - request prompt the operator types
 *   - expected pre-delegate thinking trace (RAW, persisted)
 *   - expected delegate tool_call shape
 *   - expected operator-visible reply from Kasia
 *   - banned tokens that MUST NOT appear anywhere
 *   - tokens that MUST appear in the visible reply
 *
 * This contract is the missing layer between Tier 1 unit specs
 * (which only test humanizeJargon mapping) and Tier 3 live
 * walks (which need infra). Tier 2.5: assertion harness ready,
 * model output mocked from fixture.
 */

const FIXTURE_PATH =
  "tests/e2e/fixtures/r-marti-h-arch-4-delegated-reply.json";

type ContractFixture = {
  scenario: string;
  request: string;
  expected_pre_delegate_thinking: string;
  expected_delegate_call: { tool: string; to: string; task: string };
  expected_kasia_reply_to_operator: string;
  banned_tokens_anywhere: string[];
  must_contain_in_visible_reply: string[];
};

async function loadFixture(): Promise<ContractFixture> {
  const raw = await readFile(resolve(process.cwd(), FIXTURE_PATH), "utf8");
  return JSON.parse(raw) as ContractFixture;
}

test.describe("R-MARTI H-ARCH-4 fixture-driven contract", () => {
  test("fixture loads + has all required sections", async () => {
    const f = await loadFixture();
    expect(f.scenario).toContain("H-ARCH-4");
    expect(f.request.length).toBeGreaterThan(20);
    expect(f.expected_delegate_call.tool).toBe("agent_invoke");
    expect(f.expected_delegate_call.to).toBe("kasia");
    expect(f.banned_tokens_anywhere.length).toBeGreaterThan(8);
    expect(f.must_contain_in_visible_reply.length).toBeGreaterThan(0);
  });

  test("expected_kasia_reply_to_operator passes banned-token gate", async () => {
    const f = await loadFixture();
    for (const banned of f.banned_tokens_anywhere) {
      expect(
        f.expected_kasia_reply_to_operator,
        `expected_kasia_reply leaks banned "${banned}"`,
      ).not.toContain(banned);
    }
  });

  test("expected_kasia_reply_to_operator contains all required tokens", async () => {
    const f = await loadFixture();
    for (const required of f.must_contain_in_visible_reply) {
      expect(
        f.expected_kasia_reply_to_operator,
        `expected_kasia_reply missing required "${required}"`,
      ).toContain(required);
    }
  });

  test("delegate_call shape matches H-ARCH-4 contract (agent_invoke to kasia, non-empty task)", async () => {
    const f = await loadFixture();
    expect(f.expected_delegate_call.tool).toBe("agent_invoke");
    expect(f.expected_delegate_call.to).toBe("kasia");
    expect(f.expected_delegate_call.task.length).toBeGreaterThan(20);
    // The task description itself must not leak banned tokens -
    // it will be persisted to rgaios_audit_log and could surface
    // via /trace or a debug panel.
    for (const banned of ["lookup_my_files", "find_file_owner", "agent_invoke"]) {
      expect(f.expected_delegate_call.task).not.toContain(banned);
    }
  });

  test("pre_delegate_thinking is a single line (one-line trace contract)", async () => {
    const f = await loadFixture();
    expect(f.expected_pre_delegate_thinking).not.toContain("\n");
    expect(f.expected_pre_delegate_thinking.length).toBeLessThan(600);
  });

  test("banned-list covers H-ARCH-2g proper-noun storage suffixes", async () => {
    const f = await loadFixture();
    // H-ARCH-2g + 2h shipped peer-pronoun + storage-suffix scrubs.
    // Fixture must enforce those bans so any future regression
    // that re-leaks "Kasia's tasks" / etc fails the contract.
    expect(f.banned_tokens_anywhere).toContain("Kasia's tasks");
    expect(f.banned_tokens_anywhere).toContain("Kasia's files");
    expect(f.banned_tokens_anywhere).toContain("Kasia's data");
  });

  test("banned-list covers HOTFIX 24 reasoning-chip leaks", async () => {
    const f = await loadFixture();
    // HOTFIX 24 banned FLEX MODE + shared memory + Pedro in the
    // reasoning chip. Fixture must enforce.
    expect(f.banned_tokens_anywhere).toContain("FLEX MODE");
    expect(f.banned_tokens_anywhere).toContain("shared memory");
    expect(f.banned_tokens_anywhere).toContain("Pedro");
  });

  test("banned-list covers raw tool names (H22 + jargon-coverage-extend)", async () => {
    const f = await loadFixture();
    expect(f.banned_tokens_anywhere).toContain("lookup_my_files");
    expect(f.banned_tokens_anywhere).toContain("apify_top_reels_from_file");
    expect(f.banned_tokens_anywhere).toContain("agent_invoke");
    expect(f.banned_tokens_anywhere).toContain("knowledge_query");
  });

  test.fixme(
    "live walk: when infra unblocks, this contract drives the tier-3 R-MARTI-CANONICAL walk assertion",
    async () => {
      // Promotion: stub apify with marti-canonical-reels fixture,
      // sign in admin, fire f.request, capture SSE stream,
      // assert banned + must-contain against the streamed reply.
      // No code change here once seed-fixture lands - the
      // assertion harness above already does the validation,
      // this fixme just wires it to the live page.
      expect(true).toBe(true);
    },
  );
});

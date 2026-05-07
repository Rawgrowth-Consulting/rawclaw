import { expect, test } from "@playwright/test";

/**
 * E2E coverage for the audit-call paste flow (Plan §12, Chris brief).
 *
 * Two assertions:
 *   1. POST /api/audit-call without a session returns 401. The route
 *      must gate on getOrgContext BEFORE it touches the LLM, otherwise
 *      a malicious paste could burn budget on an unauthed loop.
 *   2. POST with auth + a valid transcript returns 200 with the
 *      documented shape ({ ok, summary, painPoints, gaps, suggestedAgents }).
 *      We hit the real LLM (no mock layer) because the seam is out of
 *      reach from the test runner; the test is skipped automatically if
 *      no provider key is set, so CI without secrets stays green.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3002";
const EMAIL = process.env.E2E_OWNER_EMAIL ?? "pedro-onboard@rawclaw.demo";
const PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "rawclaw-onboard-2026";

const TRANSCRIPT_FIXTURE = `Operator: Welcome - tell me about the company.
Owner: We run a niche B2B coaching practice for solo accountants. Mostly retainer.
Operator: What hurts right now?
Owner: Lead flow is patchy. We have no consistent follow-up cadence. We rely on referrals.
Operator: Where are the operating gaps?
Owner: We have nobody owning outbound, no content cadence, and our brand voice is all over the place.
Operator: What would a good 90-day plan look like?
Owner: Get an SDR running cold outbound, get a copywriter on a weekly LinkedIn cadence, and tighten the brand voice across all channels.`;

test.setTimeout(180_000);

async function signIn(page: import("@playwright/test").Page) {
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
        callbackUrl: `${BASE_URL}/audit-call`,
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

test.describe("audit-call paste flow", () => {
  test("POST /api/audit-call without a session returns 401", async ({
    request,
  }) => {
    // Fresh request context so no auth cookie leaks from another test.
    const r = await request.post(`${BASE_URL}/api/audit-call`, {
      data: { transcript: TRANSCRIPT_FIXTURE },
      headers: { "content-type": "application/json" },
    });
    expect(r.status(), `status=${r.status()}`).toBe(401);
  });

  test("POST /api/audit-call with auth + valid transcript returns 200 + the documented shape", async ({
    page,
  }) => {
    test.skip(
      !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY,
      "no LLM provider key wired - skipping live extraction round-trip",
    );
    await signIn(page);
    const res = await page.request.post(`${BASE_URL}/api/audit-call`, {
      data: {
        transcript: TRANSCRIPT_FIXTURE,
        source: "audit_call_paste",
      },
      headers: { "content-type": "application/json" },
    });
    expect(res.status(), `status=${res.status()}`).toBe(200);
    const body = (await res.json()) as {
      ok?: boolean;
      summary?: string;
      painPoints?: string[];
      gaps?: string[];
      suggestedAgents?: { role: string; why: string; starterFiles: string[] }[];
    };
    expect(body.ok).toBe(true);
    expect(typeof body.summary).toBe("string");
    expect(Array.isArray(body.painPoints)).toBe(true);
    expect(Array.isArray(body.gaps)).toBe(true);
    expect(Array.isArray(body.suggestedAgents)).toBe(true);
  });

  test("POST /api/audit-call with empty transcript returns 400", async ({
    page,
  }) => {
    await signIn(page);
    const res = await page.request.post(`${BASE_URL}/api/audit-call`, {
      data: { transcript: "" },
      headers: { "content-type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });
});

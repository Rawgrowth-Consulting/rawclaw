/**
 * Auth helpers for routes gated by an env-var secret (cron + webhooks).
 *
 *   const denied = requireCronAuth(req);
 *   if (denied) return denied;
 *
 * Both helpers share the same fail-closed-in-prod policy:
 *   - secret set: require match. 401 on mismatch.
 *   - secret unset + NODE_ENV=production: 500 generic
 *     "server misconfigured". Without the secret, anyone could call
 *     the route and trigger expensive work or forge state.
 *   - secret unset + non-prod: allow (local dev bypass).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Generic fail-closed gate. Returns null when the env-var secret is
 * present (caller proceeds to validate the request body / signature),
 * a 500 response when prod is missing the secret, or null when non-prod
 * is missing it. Specific name kept out of the response body so an
 * attacker can't enumerate which env var is misconfigured.
 */
export function failClosedIfProd(envVar: string): NextResponse | null {
  if (process.env[envVar]) return null;
  if (process.env.NODE_ENV === "production") {
    console.error(`[auth] ${envVar} unset in production - refusing request`);
    return NextResponse.json(
      { error: "server misconfigured" },
      { status: 500 },
    );
  }
  return null;
}

export function requireCronAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return null;
  }
  return failClosedIfProd("CRON_SECRET");
}

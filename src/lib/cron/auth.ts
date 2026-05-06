/**
 * Cron auth helper. Use from any /api/cron/* route handler:
 *
 *   const denied = requireCronAuth(req);
 *   if (denied) return denied;
 *
 * Behavior:
 *   - CRON_SECRET set: require Authorization: Bearer <secret>. 401 on
 *     mismatch or missing header.
 *   - CRON_SECRET unset + NODE_ENV=production: fail closed (return 500).
 *     Without the secret a misconfigured prod deploy would expose every
 *     cron endpoint to unauthenticated callers, which is how an attacker
 *     could fan out expensive Atlas runs across all orgs.
 *   - CRON_SECRET unset + NODE_ENV != production: allow (local dev
 *     bypass; matches current dev-bootstrap.sh which ships an empty
 *     secret).
 *
 * Returns:
 *   - null if the request is authorized
 *   - a NextResponse to short-circuit the route otherwise
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function requireCronAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return null;
  }
  if (process.env.NODE_ENV === "production") {
    // No secret in prod = misconfigured deploy. Refuse rather than
    // serve the cron unauthenticated.
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  return null;
}

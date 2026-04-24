import { NextResponse } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import {
  buildAuthorizeUrl,
  makePkcePair,
  packState,
} from "@/lib/agent/oauth";

export const runtime = "nodejs";

/**
 * POST /api/connections/claude/oauth/start
 *
 * Kicks off the server-side Claude Max OAuth flow. Returns the authorize
 * URL the user opens in their browser, plus the state we need them to
 * send back with the code (the verifier is encrypted inside `state`).
 */
export async function POST() {
  try {
    const organizationId = await currentOrganizationId();
    const { verifier, challenge } = makePkcePair();
    const state = packState({ verifier, organizationId });
    const url = buildAuthorizeUrl({ challenge, state });
    return NextResponse.json({ ok: true, url, state });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

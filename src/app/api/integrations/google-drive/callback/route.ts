import { NextResponse, type NextRequest } from "next/server";
import { exchangeCodeForTokens, saveDriveConnection } from "@/lib/google/oauth";
import { syncDrive } from "@/lib/google/drive";

export const runtime = "nodejs";

const INTEGRATION_ID = "google-drive";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const stored = req.cookies.get("g_oauth_state")?.value;

  if (error) {
    return redirectToIntegrations(
      req,
      `error=${encodeURIComponent(error)}`,
    );
  }
  if (!code) {
    return redirectToIntegrations(req, "error=missing_code");
  }
  if (!state || !stored || state !== stored) {
    return redirectToIntegrations(req, "error=state_mismatch");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    saveDriveConnection(INTEGRATION_ID, tokens);

    // Kick off initial sync — intentionally awaited for MVP so the redirect
    // lands on a populated /integrations page. Move to background for prod.
    const summary = await syncDrive({ maxFiles: 50 });

    const res = redirectToIntegrations(
      req,
      `connected=google-drive&synced=${summary.ingested}`,
    );
    res.cookies.delete("g_oauth_state");
    return res;
  } catch (err) {
    const msg = (err as Error).message ?? "unknown";
    return redirectToIntegrations(
      req,
      `error=${encodeURIComponent(msg)}`,
    );
  }
}

function redirectToIntegrations(req: NextRequest, qs: string) {
  const origin = new URL(req.url).origin;
  return NextResponse.redirect(`${origin}/integrations?${qs}`);
}

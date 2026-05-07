import { NextResponse, type NextRequest } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import { getConnection } from "@/lib/connections/queries";
import { providerConfigKeyFor } from "@/lib/connections/providers";

export const runtime = "nodejs";

/**
 * GET /api/onboarding/integration-status/[provider]
 *
 * Lightweight polling endpoint used by IntegrationConnectorBlock during
 * onboarding. Reads the active org's rgaios_connections row for the
 * given provider via providerConfigKeyFor() so the chat-side widget can
 * detect "OAuth landed" without subscribing to the Nango webhook stream.
 *
 * Returns: { connected: boolean, displayName?: string }
 */

const SUPPORTED = new Set(["slack", "hubspot", "google-drive", "gmail"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider } = await params;
    if (!SUPPORTED.has(provider)) {
      return NextResponse.json(
        { error: `Unsupported provider: ${provider}` },
        { status: 400 },
      );
    }

    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const providerConfigKey = providerConfigKeyFor(provider);
    if (!providerConfigKey) {
      return NextResponse.json(
        { error: `No provider config mapped for ${provider}` },
        { status: 400 },
      );
    }

    const conn = await getConnection(ctx.activeOrgId, providerConfigKey);
    if (!conn) {
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({
      connected: conn.status === "connected",
      displayName: conn.display_name ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

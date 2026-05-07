import { NextResponse } from "next/server";

// Portal's /api/onboarding/api-keys handed third-party API keys to Slack
// for Rawgrowth operators to store securely. Out of scope for the v3 trial:
// client API keys are managed via Composio connectors (see /connections)
// or env vars at provisioning time. Kept as a stub so the UI references
// do not 404 while we cut the dead code out of OnboardingChat.
export async function GET() {
  return NextResponse.json({ integrations: [] });
}

export async function POST() {
  return NextResponse.json(
    { error: "api-keys flow deprecated in v3; use Composio at /connections instead" },
    { status: 410 },
  );
}

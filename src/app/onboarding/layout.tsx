import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  // Admins hitting the onboarding path directly (without impersonating a
  // client) get bounced to the home dashboard; onboarding is an owner-only
  // flow for their own org.
  if (ctx.isAdmin && !ctx.isImpersonating) redirect("/");

  // Only kick the user out of onboarding when BOTH gates are satisfied:
  //   1. rgaios_organizations.onboarding_completed = true
  //   2. A brand_profile row exists for the org (any version, any status)
  // If either is missing, the user can re-enter the chat to fix or extend
  // their brand profile. Previously a half-finished chat (onboarding_step
  // > 0 with no profile generated) would bounce them straight to "/" and
  // strand them on /brand's "No brand profile yet" empty state.
  const db = supabaseAdmin();
  const [{ data: org }, { data: profile }] = await Promise.all([
    db
      .from("rgaios_organizations")
      .select("onboarding_completed")
      .eq("id", ctx.activeOrgId)
      .maybeSingle(),
    db
      .from("rgaios_brand_profiles")
      .select("id")
      .eq("organization_id", ctx.activeOrgId)
      .limit(1)
      .maybeSingle(),
  ]);

  if (org?.onboarding_completed && profile?.id) redirect("/");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#060B08]">
      {children}
    </div>
  );
}

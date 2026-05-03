import Image from "next/image";
import Link from "next/link";

import { getOrgContext } from "@/lib/auth/admin";
import { computeOnboardingProgress } from "@/lib/onboarding";
import { supabaseAdmin } from "@/lib/supabase/server";
import OnboardingChat from "./OnboardingChat";

export default async function OnboardingPage() {
  const ctx = await getOrgContext();
  const firstName = ctx?.userName ? ctx.userName.split(" ")[0] : null;
  const initialProgress = ctx?.activeOrgId
    ? await computeOnboardingProgress(ctx.activeOrgId)
    : { current: 0, total: 14, completed: [] };

  // Pre-onboarding gate: agent chat post-onboarding only works if Claude
  // Max OAuth is wired. Surface a banner up top so the operator can
  // connect first instead of finding out their first chat fails.
  let claudeMaxConnected = false;
  if (ctx?.activeOrgId) {
    const { data } = await supabaseAdmin()
      .from("rgaios_connections")
      .select("id")
      .eq("organization_id", ctx.activeOrgId)
      .eq("provider_config_key", "claude-max")
      .maybeSingle();
    claudeMaxConnected = !!data;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="rg-fade-in shrink-0 border-b border-[rgba(255,255,255,0.06)] bg-[#0A1210]/60">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-6 py-5 md:px-8">
          <Image
            src="/rawgrowth.png"
            alt="Rawgrowth"
            width={32}
            height={32}
            priority
            className="h-8 w-8 object-contain"
          />
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-2xl font-normal tracking-tight text-foreground">
              Onboarding
            </h1>
            <p className="text-sm text-muted-foreground">
              Let&apos;s get to know your business.
            </p>
          </div>
          <Link
            href="/api/onboarding/skip"
            className="shrink-0 rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface)] px-3 py-1.5 text-[12px] text-[var(--text-muted)] hover:border-primary/40 hover:text-primary"
            title="Skip onboarding for now (you can come back from the sidebar)"
          >
            Skip for now
          </Link>
        </div>
      </header>

      {!claudeMaxConnected && (
        <div className="rg-fade-in shrink-0 border-b border-amber-400/20 bg-amber-400/5">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 px-6 py-3 md:px-8">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-amber-200">
                Connect Claude Max to enable agent chat
              </p>
              <p className="mt-0.5 text-[11px] text-amber-200/70">
                You can do this now or after onboarding. Without it, agents
                won&apos;t be able to reply once your AI org is wired.
              </p>
            </div>
            <Link
              href="/connections"
              className="shrink-0 rounded-md bg-amber-400/15 px-3 py-1.5 text-[12px] font-medium text-amber-200 hover:bg-amber-400/25"
            >
              Connect now →
            </Link>
          </div>
        </div>
      )}

      {/* Chat */}
      <div className="min-h-0 flex-1">
        <OnboardingChat firstName={firstName} initialProgress={initialProgress} />
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { Palette } from "lucide-react";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";

/**
 * Read-only brand profile view. The authoritative copy lives in
 * rgaios_brand_profiles (status='approved', highest version). Operators
 * edit through the onboarding chat's approve_brand_profile flow; this
 * page just renders whatever landed.
 */
export default async function BrandProfilePage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  const { data: profile } = await supabaseAdmin()
    .from("rgaios_brand_profiles")
    .select("id, version, content, status, generated_at, approved_at")
    .eq("organization_id", ctx.activeOrgId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const subtitle = profile
    ? `Version ${profile.version} · ${profile.status}${
        profile.approved_at
          ? ` · approved ${new Date(Number(profile.approved_at)).toLocaleDateString()}`
          : ""
      }`
    : "Generated from onboarding. Edit by re-running the onboarding chat.";

  return (
    <PageShell
      title={ctx.activeOrgName ?? "Brand profile"}
      description={subtitle}
    >
      <div className="max-w-3xl">
        {profile?.content ? (
          <article className="max-w-none">
            <ReactMarkdown
              components={{
                h1: ({ children }) => (
                  <h1 className="mb-4 mt-6 font-serif text-3xl tracking-tight text-foreground first:mt-0">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="mb-3 mt-8 font-serif text-xl tracking-tight text-foreground">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="mb-2 mt-6 text-[13px] font-semibold uppercase tracking-[1.5px] text-primary">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="mb-4 ml-5 list-disc space-y-1.5 text-sm text-muted-foreground marker:text-primary/60">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="mb-4 ml-5 list-decimal space-y-1.5 text-sm text-muted-foreground marker:text-primary/60">
                    {children}
                  </ol>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-foreground">{children}</strong>
                ),
                code: ({ children }) => (
                  <code className="rounded bg-muted/40 px-1 py-0.5 font-mono text-[12px] text-primary">
                    {children}
                  </code>
                ),
              }}
            >
              {profile.content}
            </ReactMarkdown>
          </article>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card/30 p-10 text-center">
            <Palette className="mx-auto size-9 text-primary/70" strokeWidth={1.4} />
            <h3 className="mt-4 font-serif text-xl tracking-tight text-foreground">
              No brand profile yet
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              The brand profile is a markdown doc the agents read at runtime to
              keep voice, banned words, and offer details consistent. Generate
              it from the onboarding chat (intake -&gt; scrape -&gt; auto-write
              -&gt; you approve).
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <Link
                href="/onboarding"
                className="inline-flex h-8 items-center rounded-[min(var(--radius-md),12px)] bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80"
              >
                Start onboarding
              </Link>
              <Link
                href="/knowledge"
                className="inline-flex h-8 items-center rounded-[min(var(--radius-md),12px)] border border-border px-3 text-sm hover:border-primary/40"
              >
                Or upload SOPs first
              </Link>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}

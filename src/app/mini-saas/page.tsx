import Link from "next/link";
import { redirect } from "next/navigation";
import { Code2, Plus } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { NewMiniSaasButton } from "./NewMiniSaasButton";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted/40 text-muted-foreground",
  generating: "bg-amber-400/15 text-amber-300",
  ready: "bg-primary/15 text-primary",
  failed: "bg-destructive/15 text-destructive",
};

function fmt(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "-";
  const ms = Date.now() - t;
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function MiniSaasIndex() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");
  const { data: rows } = await supabaseAdmin()
    .from("rgaios_mini_saas")
    .select("id, title, description, status, created_at, updated_at")
    .eq("organization_id", ctx.activeOrgId)
    .order("created_at", { ascending: false })
    .limit(100);
  const apps = (rows ?? []) as Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  }>;

  return (
    <PageShell
      title="Mini SaaS"
      description="Tiny self-contained internal tools your Engineering Manager builds for you. Describe it in one line - the agent generates a self-contained HTML+JS app you can preview, iterate on, and share."
      actions={<NewMiniSaasButton />}
    >
      {apps.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card/30 p-10 text-center">
          <Code2 className="mx-auto size-9 text-primary/60" strokeWidth={1.4} />
          <h3 className="mt-3 font-serif text-xl tracking-tight text-foreground">
            No mini apps yet
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Click <span className="text-primary">+ New mini SaaS</span> and
            describe a tiny internal tool (a CAC calculator, a daily standup
            tracker, a brand-voice rewriter, anything self-contained). The
            Engineering Manager generates it inline and you preview it in a
            sandboxed iframe.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {apps.map((a) => (
            <Link
              key={a.id}
              href={`/mini-saas/${a.id}`}
              className="rounded-md border border-border bg-card/40 p-5 transition-[border-color] duration-200 hover:border-primary/50"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="truncate text-[14px] font-medium text-foreground">
                  {a.title}
                </h3>
                <span
                  className={
                    "shrink-0 rounded px-2 py-0.5 text-[10px] uppercase tracking-widest " +
                    (STATUS_TONE[a.status] ?? STATUS_TONE.draft)
                  }
                >
                  {a.status}
                </span>
              </div>
              {a.description && (
                <p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                  {a.description}
                </p>
              )}
              <p className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                {fmt(a.updated_at ?? a.created_at)}
              </p>
            </Link>
          ))}
          <Link
            href="#new"
            className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card/20 p-5 text-[12px] text-muted-foreground transition-[border-color] duration-200 hover:border-primary/40 hover:text-primary"
          >
            <Plus className="size-4" />
            New mini SaaS
          </Link>
        </div>
      )}
    </PageShell>
  );
}

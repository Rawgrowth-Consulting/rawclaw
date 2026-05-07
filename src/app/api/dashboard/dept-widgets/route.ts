import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/admin";
import { isDepartmentAllowed } from "@/lib/auth/dept-acl";

export const runtime = "nodejs";

// Per-department context widgets. The four canonical pillars get a
// short row of cards on /departments/[slug] above the agent list:
//
//   marketing   -> scrape snapshot count + Apify sync status
//   fulfilment  -> open routine_runs + recent runs (7d)
//   finance     -> stripe-tagged company_chunks count + MRR estimate
//   development -> agents in dept + recent agent_skills changes
//
// Sales is owned by Worker B's CRM widget so we deliberately do NOT
// branch on slug='sales' here. Unknown / custom slugs return an empty
// widgets array so the component just renders nothing instead of an
// error toast.

type Widget = {
  id: string;
  label: string;
  value: string;
  hint: string;
};

export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;

  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  }

  const allowed = await isDepartmentAllowed(
    {
      userId: ctx.userId,
      organizationId: orgId,
      isAdmin: ctx.isAdmin,
    },
    slug,
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = supabaseAdmin();
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  let widgets: Widget[] = [];

  switch (slug) {
    case "marketing": {
      const [snapshotsRes, recentRes] = await Promise.all([
        db
          .from("rgaios_scrape_snapshots")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId),
        db
          .from("rgaios_scrape_snapshots")
          .select("status, scraped_at")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      const recent = recentRes.data ?? [];
      const succeeded = recent.filter((r) => r.status === "succeeded").length;
      const lastScrape = recent.find((r) => r.scraped_at)?.scraped_at ?? null;
      const lastHint = lastScrape
        ? `last ${new Date(lastScrape).toISOString().slice(0, 10)}`
        : "no scrapes yet";
      const apifyHint =
        recent.length === 0
          ? "no runs yet"
          : `${succeeded}/${recent.length} succeeded`;
      widgets = [
        {
          id: "scrape-total",
          label: "Scrape snapshots",
          value: String(snapshotsRes.count ?? 0),
          hint: lastHint,
        },
        {
          id: "apify-recent",
          label: "Recent scrape runs",
          value: String(recent.length),
          hint: apifyHint,
        },
      ];
      break;
    }

    case "fulfilment": {
      const [pendingRes, recentRes, succeededRes] = await Promise.all([
        db
          .from("rgaios_routine_runs")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("status", "pending"),
        db
          .from("rgaios_routine_runs")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .gte("created_at", sevenDaysAgo),
        db
          .from("rgaios_routine_runs")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("status", "succeeded")
          .gte("created_at", sevenDaysAgo),
      ]);
      widgets = [
        {
          id: "open-tasks",
          label: "Open tasks",
          value: String(pendingRes.count ?? 0),
          hint: "pending routine runs",
        },
        {
          id: "recent-runs",
          label: "Runs in 7d",
          value: String(recentRes.count ?? 0),
          hint: `${succeededRes.count ?? 0} succeeded`,
        },
      ];
      break;
    }

    case "finance": {
      const stripeRes = await db
        .from("rgaios_company_chunks")
        .select("id, metadata", { count: "exact" })
        .eq("organization_id", orgId)
        .eq("source", "stripe");
      const rows = stripeRes.data ?? [];
      // MRR rough estimate: sum monthly_recurring from metadata when
      // present. Stripe ingestion drops { amount, currency,
      // monthly_recurring, ... } into metadata. If nothing there we
      // fall through to "no data" hint instead of fabricating a number.
      let mrrCents = 0;
      let mrrSeen = 0;
      for (const r of rows) {
        const meta = (r.metadata as Record<string, unknown> | null) ?? {};
        const v = meta.monthly_recurring;
        if (typeof v === "number" && Number.isFinite(v)) {
          mrrCents += v;
          mrrSeen += 1;
        }
      }
      const mrrHint =
        mrrSeen === 0
          ? "no data"
          : `${mrrSeen} sub${mrrSeen === 1 ? "" : "s"} sampled`;
      const mrrValue =
        mrrSeen === 0
          ? " - "
          : `$${(mrrCents / 100).toFixed(0)}`;
      widgets = [
        {
          id: "invoices",
          label: "Invoices",
          value: String(stripeRes.count ?? 0),
          hint: "stripe-sourced chunks",
        },
        {
          id: "mrr",
          label: "MRR estimate",
          value: mrrValue,
          hint: mrrHint,
        },
      ];
      break;
    }

    case "development": {
      const [agentsRes, skillsRes] = await Promise.all([
        db
          .from("rgaios_agents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("department", "development"),
        db
          .from("rgaios_agent_skills")
          .select("agent_id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .gte("created_at", sevenDaysAgo),
      ]);
      widgets = [
        {
          id: "dev-agents",
          label: "Development agents",
          value: String(agentsRes.count ?? 0),
          hint: "in this department",
        },
        {
          id: "skills-changes",
          label: "Skill changes (7d)",
          value: String(skillsRes.count ?? 0),
          hint: "new skill assignments",
        },
      ];
      break;
    }

    default: {
      // Sales is intentionally not handled here (Worker B owns the CRM
      // widget). Unknown / custom slugs simply get no widgets.
      widgets = [];
    }
  }

  return NextResponse.json({ slug, widgets });
}

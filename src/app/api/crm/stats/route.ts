import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/admin";
import { isDepartmentAllowed } from "@/lib/auth/dept-acl";

// nodejs runtime so the service-role supabase client and JSON aggregation
// over jsonb metadata work the same way they do in /api/dashboard/stats.
// rgaios_company_chunks lives behind RLS by organization_id; getOrgContext
// is the single gate, never trust ?org= from the URL.
export const runtime = "nodejs";

// Sources that the v3 CRM widget aggregates. Aligned with the
// Composio-app-name vocabulary used elsewhere in the repo so we don't
// silently miss rows when a new CRM integration lands. Lower-case to
// match how the ingest path tags chunks (see src/lib/connections/*).
const CRM_SOURCES = ["hubspot", "pipedrive", "attio", "close"] as const;

type CrmMetadata = {
  object?: string;
  amount?: number | string;
  name?: string;
  title?: string;
  stage?: string;
  pipeline_stage?: string;
};

type CompanyChunkRow = {
  source: string;
  metadata: CrmMetadata | null;
  created_at: string | null;
};

type TopRecent = {
  name: string;
  value: number;
  stage: string;
};

type Response = {
  source: string;
  contacts: number;
  deals: number;
  pipelineValue: number;
  topRecent: TopRecent[];
};

export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;

  // The widget is sales-only per Plan §8. We still take ?department=
  // so the route stays generic if marketing later wants its own CRM
  // surface (intent leads, etc). Default to 'sales' when omitted.
  const url = req.nextUrl;
  const rawDept = url.searchParams.get("department");
  const department =
    typeof rawDept === "string" && rawDept.length > 0 ? rawDept : "sales";

  const allowed = await isDepartmentAllowed(
    {
      userId: ctx.userId,
      organizationId: orgId,
      isAdmin: ctx.isAdmin,
    },
    department,
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = supabaseAdmin();

  // Single read of all CRM chunks for the org. Aggregation happens in
  // JS because postgrest cannot sum a json-cast field through the
  // generic client and we want to keep this route portable across the
  // self-hosted SQL surface that does not expose custom RPCs by
  // default.
  const { data, error } = await db
    .from("rgaios_company_chunks")
    .select("source, metadata, created_at")
    .eq("organization_id", orgId)
    .in("source", CRM_SOURCES as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as CompanyChunkRow[];

  // contact_count = total rows; deal_count = rows where metadata.object
  // = 'deal'; pipeline value sums numeric metadata.amount on deal rows
  // only. The five-row recent list pulls deal rows first, then falls
  // back to any chunk so an empty-pipeline org still sees signal.
  let deals = 0;
  let pipelineValue = 0;
  const dealRows: CompanyChunkRow[] = [];
  for (const row of rows) {
    const meta = row.metadata ?? {};
    if (meta.object === "deal") {
      deals += 1;
      const amt = typeof meta.amount === "string" ? Number(meta.amount) : meta.amount;
      if (typeof amt === "number" && Number.isFinite(amt)) {
        pipelineValue += amt;
      }
      dealRows.push(row);
    }
  }

  const recentSource = dealRows.length > 0 ? dealRows : rows;
  const topRecent: TopRecent[] = recentSource.slice(0, 5).map((row) => {
    const meta = row.metadata ?? {};
    const amt = typeof meta.amount === "string" ? Number(meta.amount) : meta.amount;
    return {
      name: (meta.name ?? meta.title ?? "Untitled").toString(),
      value: typeof amt === "number" && Number.isFinite(amt) ? amt : 0,
      stage: (meta.stage ?? meta.pipeline_stage ?? "").toString(),
    };
  });

  // 'source' surfaces which CRM the data came from so the UI can show
  // a label. When more than one CRM is connected we return the top
  // source by row count so the widget stays single-line. Multi-CRM
  // breakdown lands later.
  const sourceCounts = new Map<string, number>();
  for (const row of rows) {
    sourceCounts.set(row.source, (sourceCounts.get(row.source) ?? 0) + 1);
  }
  let dominant = "";
  let dominantCount = -1;
  for (const [s, c] of sourceCounts) {
    if (c > dominantCount) {
      dominant = s;
      dominantCount = c;
    }
  }

  const body: Response = {
    source: dominant,
    contacts: rows.length,
    deals,
    pipelineValue,
    topRecent,
  };
  return NextResponse.json(body);
}

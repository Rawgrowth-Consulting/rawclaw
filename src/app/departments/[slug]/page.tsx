import { notFound, redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { DashboardStats } from "@/components/dashboard/stats";
import { InsightsPanel } from "@/components/insights/insights-panel";
import { OrgChart } from "@/components/org-chart";
import { AgentSheet } from "@/components/agent-sheet";
import { getOrgContext } from "@/lib/auth/admin";
import { isDepartmentAllowed } from "@/lib/auth/dept-acl";
import { DEFAULT_DEPARTMENTS } from "@/lib/agents/dto";
import { DepartmentAgentList } from "./DepartmentAgentList";

export const dynamic = "force-dynamic";

function capitalize(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/_/g, " ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return { title: `${capitalize(slug)}  -  Rawgrowth` };
}

export default async function DepartmentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Hard-validate against the seeded slugs only. Custom dept slugs from
  // /departments/new are valid on the flat list but the per-dept dashboard
  // ships with the five canonical pillars first - custom dashboards land
  // post-trial. Unknown slug -> 404 so URL-typing doesn't render a blank
  // page with zeroed stats.
  if (!(DEFAULT_DEPARTMENTS as readonly string[]).includes(slug)) {
    notFound();
  }

  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  // Per-dept ACL: a marketing-only invitee that types /departments/sales
  // gets a 404 instead of a confusing empty page that leaks the slug
  // existed.
  if (ctx.userId) {
    const allowed = await isDepartmentAllowed(
      {
        userId: ctx.userId,
        organizationId: ctx.activeOrgId,
        isAdmin: ctx.isAdmin,
      },
      slug,
    );
    if (!allowed) notFound();
  }

  const title = capitalize(slug);

  return (
    <PageShell
      title={title}
      description={`${title} agents and KPIs`}
      actions={
        <AgentSheet
          triggerLabel={`+ Hire into ${title}`}
          triggerSize="sm"
        />
      }
    >
      <DashboardStats department={slug} />

      <div className="mt-6">
        <InsightsPanel department={slug} />
      </div>

      <div className="mt-6 mb-6">
        <OrgChart departmentSlug={slug} />
      </div>

      <DepartmentAgentList slug={slug} />
    </PageShell>
  );
}

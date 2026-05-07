import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { AuditCallClient } from "./AuditCallClient";

export const dynamic = "force-dynamic";

/**
 * /audit-call - Plan §12 paste-flow surface. The operator (or the
 * client themselves) pastes a discovery / audit-call transcript and we
 * return a structured plan: company summary, pain points, gaps, and a
 * roster of agents to hire. Every suggested agent is pre-created as a
 * draft row so the operator can promote them from /agents without
 * re-typing.
 */
export default async function AuditCallPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  return (
    <PageShell
      title="Audit call paste"
      description="Paste a discovery or audit-call transcript. We extract a one-paragraph company summary, the operator's pain points, the operating gaps, and a roster of suggested agents to hire. Every suggestion is saved as a draft you can promote from /agents."
    >
      <AuditCallClient />
    </PageShell>
  );
}

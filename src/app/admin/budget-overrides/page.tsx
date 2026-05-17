import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import {
  fetchOrgBudgetOverrides,
  type OrgBudgetOverrideRow,
} from "@/lib/agent/budget-overrides";
import BUDGET_POLICY_CONFIG from "@/lib/agent/budget-policy.config.json";
import { BudgetOverridesClient } from "./Client";

export const dynamic = "force-dynamic";

export type BudgetOverrideRow = OrgBudgetOverrideRow;

export type BudgetDefaults = {
  ceo: number;
  deptHead: number;
  specialist: number;
};

/**
 * F-7: admin per-org chat-budget tier override page. Lists the
 * three role tiers (ceo / deptHead / specialist), shows the global
 * default from budget-policy.config.json next to each, and lets
 * the operator override per-org. Empty override = use default.
 *
 * Consumer wiring (computeChatBudget reads overrides per turn) is
 * an A-lane follow-up; this PR only owns storage + UI.
 */
export default async function AdminBudgetOverridesPage() {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin || !ctx.activeOrgId) redirect("/auth/signin");

  const { rows } = await fetchOrgBudgetOverrides(ctx.activeOrgId);
  const defaults = (BUDGET_POLICY_CONFIG as { roleBudget: BudgetDefaults }).roleBudget;

  return (
    <PageShell
      title="Chat budget overrides"
      description="Per-org override of the chat preamble token budget for each agent tier. Empty row = use the global default from budget-policy.config.json."
    >
      <BudgetOverridesClient
        initial={rows}
        defaults={defaults}
        orgName={ctx.activeOrgName ?? ctx.activeOrgId}
      />
    </PageShell>
  );
}

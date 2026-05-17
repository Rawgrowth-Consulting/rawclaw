import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * F-7. Per-org chat budget tier override store. Backed by
 * rgaios_organization_budget_overrides (migration 0077).
 *
 * Reads return a sparse map keyed by role; absent entries fall back
 * to the global BUDGET_POLICY_CONFIG default in
 * src/lib/agent/context.ts (consumer wiring is a follow-up ticket
 * - this file only owns the data-access surface).
 *
 * Writes are admin-only (admin API route already gates on
 * getOrgContext().isAdmin). Service role bypasses RLS so the orgId
 * is pinned from the caller's verified session, never from the JWT
 * inside the row.
 */

export type BudgetRole = "ceo" | "deptHead" | "specialist";

export const BUDGET_ROLES: ReadonlyArray<BudgetRole> = [
  "ceo",
  "deptHead",
  "specialist",
];

const MAX_BUDGET_TOKENS = 1_000_000;

export type OrgBudgetOverrides = Partial<Record<BudgetRole, number>>;

export type OrgBudgetOverrideRow = {
  role: BudgetRole;
  budget_tokens: number;
  updated_at: string;
};

function isBudgetRole(s: string): s is BudgetRole {
  return s === "ceo" || s === "deptHead" || s === "specialist";
}

/**
 * Fetch all overrides for one org. Empty object = no overrides set
 * (consumer should use global default for every role).
 */
export async function fetchOrgBudgetOverrides(
  orgId: string,
): Promise<{ overrides: OrgBudgetOverrides; rows: OrgBudgetOverrideRow[]; error?: string }> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_organization_budget_overrides")
    .select("role, budget_tokens, updated_at")
    .eq("organization_id", orgId);
  if (error) {
    return { overrides: {}, rows: [], error: error.message };
  }
  const rows = (data ?? []) as OrgBudgetOverrideRow[];
  const overrides: OrgBudgetOverrides = {};
  for (const row of rows) {
    if (isBudgetRole(row.role)) {
      overrides[row.role] = row.budget_tokens;
    }
  }
  return { overrides, rows };
}

/**
 * Upsert one (org, role) override. Returns the persisted row.
 * Caller is responsible for the admin gate; this helper trusts orgId.
 */
export async function upsertOrgBudgetOverride(
  orgId: string,
  role: BudgetRole,
  budgetTokens: number,
): Promise<{ row?: OrgBudgetOverrideRow; error?: string }> {
  if (!isBudgetRole(role)) {
    return { error: `invalid role: ${role}` };
  }
  if (!Number.isInteger(budgetTokens) || budgetTokens <= 0) {
    return { error: "budget_tokens must be a positive integer" };
  }
  if (budgetTokens > MAX_BUDGET_TOKENS) {
    return { error: `budget_tokens cannot exceed ${MAX_BUDGET_TOKENS}` };
  }
  const { data, error } = await supabaseAdmin()
    .from("rgaios_organization_budget_overrides")
    .upsert(
      {
        organization_id: orgId,
        role,
        budget_tokens: budgetTokens,
      } as never,
      { onConflict: "organization_id,role" },
    )
    .select("role, budget_tokens, updated_at")
    .single();
  if (error) {
    return { error: error.message };
  }
  return { row: data as OrgBudgetOverrideRow };
}

/**
 * Delete one (org, role) override. Returns true if a row was removed.
 */
export async function deleteOrgBudgetOverride(
  orgId: string,
  role: BudgetRole,
): Promise<{ deleted: boolean; error?: string }> {
  if (!isBudgetRole(role)) {
    return { deleted: false, error: `invalid role: ${role}` };
  }
  const { error, count } = await supabaseAdmin()
    .from("rgaios_organization_budget_overrides")
    .delete({ count: "exact" })
    .eq("organization_id", orgId)
    .eq("role", role);
  if (error) {
    return { deleted: false, error: error.message };
  }
  return { deleted: (count ?? 0) > 0 };
}

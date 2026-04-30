import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Per-department visibility ACL helpers (P1 #6 from
 * /home/pedroafonso/.claude/plans/wiggly-hugging-sutherland.md).
 *
 * Schema: rgaios_organization_memberships.allowed_departments text[]
 * (migration 0037). Empty array = no restriction (sees all).
 * Non-empty = restrict to listed slugs.
 *
 * Admin users (ctx.isAdmin) always bypass - they need the full view to
 * impersonate clients.
 *
 * Callers:
 *   - /api/agents GET filter (agents whose department isn't in the
 *     allowed set get hidden)
 *   - /api/dashboard/stats filter (stats roll-up scoped to allowed depts)
 *   - sidebar collapsible dept submenu (hide non-allowed entries)
 *   - /departments/[slug]/page.tsx (notFound if slug not allowed)
 */

export type DeptAclContext = {
  userId: string;
  organizationId: string;
  isAdmin: boolean;
};

export async function getAllowedDepartments(
  ctx: DeptAclContext,
): Promise<string[] | null> {
  if (ctx.isAdmin) return null;

  const { data } = await supabaseAdmin()
    .from("rgaios_organization_memberships")
    .select("allowed_departments")
    .eq("user_id", ctx.userId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();

  const allowed = (data?.allowed_departments ?? []) as string[];
  if (allowed.length === 0) return null;
  return allowed;
}

export async function isDepartmentAllowed(
  ctx: DeptAclContext,
  slug: string | null,
): Promise<boolean> {
  if (ctx.isAdmin) return true;
  const allowed = await getAllowedDepartments(ctx);
  if (allowed === null) return true;
  if (!slug) return false;
  return allowed.includes(slug);
}

export function filterAgentsByDept<T extends { department?: string | null }>(
  agents: T[],
  allowed: string[] | null,
): T[] {
  if (allowed === null) return agents;
  return agents.filter((a) =>
    a.department ? allowed.includes(a.department) : false,
  );
}

/**
 * Slug list every Department-Head invitee can be granted. Mirrors
 * src/lib/agents/seed.ts default departments. Add new slugs here
 * when seedDefaultAgentsForOrg grows.
 */
export const KNOWN_DEPARTMENT_SLUGS = [
  "marketing",
  "sales",
  "fulfilment",
  "finance",
  "development",
] as const;

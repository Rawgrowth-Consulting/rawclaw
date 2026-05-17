import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import {
  BUDGET_ROLES,
  type BudgetRole,
  deleteOrgBudgetOverride,
  fetchOrgBudgetOverrides,
  upsertOrgBudgetOverride,
} from "@/lib/agent/budget-overrides";

export const runtime = "nodejs";

function isBudgetRole(s: unknown): s is BudgetRole {
  return typeof s === "string" && (BUDGET_ROLES as ReadonlyArray<string>).includes(s);
}

/**
 * GET /api/admin/budget-overrides
 * Returns the override row set for the caller's org.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin || !ctx.activeOrgId) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  const { overrides, rows, error } = await fetchOrgBudgetOverrides(ctx.activeOrgId);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  return NextResponse.json({ overrides, rows });
}

/**
 * PUT /api/admin/budget-overrides
 * Body: { role: BudgetRole, budget_tokens: number }
 */
export async function PUT(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin || !ctx.activeOrgId) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as
    | { role?: unknown; budget_tokens?: unknown }
    | null;
  if (!body || !isBudgetRole(body.role)) {
    return NextResponse.json(
      { error: "role must be ceo | deptHead | specialist" },
      { status: 400 },
    );
  }
  if (typeof body.budget_tokens !== "number") {
    return NextResponse.json(
      { error: "budget_tokens must be a number" },
      { status: 400 },
    );
  }
  const { row, error } = await upsertOrgBudgetOverride(
    ctx.activeOrgId,
    body.role,
    body.budget_tokens,
  );
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }
  return NextResponse.json({ row });
}

/**
 * DELETE /api/admin/budget-overrides?role=<role>
 */
export async function DELETE(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin || !ctx.activeOrgId) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  const role = new URL(req.url).searchParams.get("role");
  if (!isBudgetRole(role)) {
    return NextResponse.json(
      { error: "role must be ceo | deptHead | specialist" },
      { status: 400 },
    );
  }
  const { deleted, error } = await deleteOrgBudgetOverride(ctx.activeOrgId, role);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  return NextResponse.json({ deleted });
}

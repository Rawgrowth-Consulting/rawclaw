import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { AutoresearchClient } from "./Client";

export const dynamic = "force-dynamic";

/**
 * Admin → Autoresearch: dashboard surface for the self-healing /
 * self-learning agent loop.
 *
 * Operator types a goal, clicks Run. We POST to
 * /api/admin/autoresearch and stream per-cycle observations back over
 * SSE as the autoresearch loop iterates. Each cycle calls the Hermes
 * agent to propose a candidate, scores it, keeps the best, and
 * persists the winning cycle's diagnostic into every enabled memory
 * tier so the next run starts smarter.
 */
export default async function AdminAutoresearchPage() {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin) redirect("/auth/signin");

  return (
    <PageShell
      title="Self-healing autoresearch"
      description="Goal-driven optimization loop. Each cycle the agent proposes, evaluates, keeps the best, and writes the diagnostic into the 4-tier memory chain so the next run learns from it."
    >
      <AutoresearchClient />
    </PageShell>
  );
}

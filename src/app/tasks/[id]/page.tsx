import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { TaskDetailClient } from "./TaskDetailClient";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  return (
    <PageShell title="Task" description="Routine + every run + agent output">
      <TaskDetailClient routineId={id} />
    </PageShell>
  );
}

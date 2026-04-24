import { redirect } from "next/navigation";

import { getOrgContext } from "@/lib/auth/admin";
import { NewDepartmentForm } from "./NewDepartmentForm";

export default async function NewDepartmentPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  return (
    <div className="mx-auto max-w-xl px-6 py-10 text-[var(--text-strong)]">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-primary">
          Add department
        </p>
        <h1 className="mt-1 text-2xl">Spin up a new department</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Creates a manager and two sub-agents with sensible defaults. You
          can rename and re-skill them right after.
        </p>
      </header>

      <NewDepartmentForm />
    </div>
  );
}

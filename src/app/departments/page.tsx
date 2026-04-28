import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { DepartmentsView } from "@/components/departments/departments-view";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Departments  -  Rawgrowth",
};

export default function DepartmentsPage() {
  return (
    <PageShell
      title="Departments"
      description="Organize your agents by business pillar. Use the seeded set or spin up your own. Every agent can stay unassigned."
      actions={
        <Button asChild variant="default" size="sm">
          <Link href="/departments/new">+ Add department</Link>
        </Button>
      }
    >
      <DepartmentsView />
    </PageShell>
  );
}

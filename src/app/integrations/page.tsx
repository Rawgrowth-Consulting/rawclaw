import { PageShell } from "@/components/page-shell";
import { IntegrationsGrid } from "@/components/integrations-grid";

export const metadata = {
  title: "Integrations — Rawgrowth",
};

export default function IntegrationsPage() {
  return (
    <PageShell
      title="Integrations"
      description="Connect the tools your business already runs on. Rawgrowth syncs data across them so your agents have real context."
    >
      <IntegrationsGrid />
    </PageShell>
  );
}

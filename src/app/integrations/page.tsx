import { PageShell } from "@/components/page-shell";
import { IntegrationsView } from "@/components/integrations-view";

export const metadata = {
  title: "Integrations — Rawgrowth",
};

export default function IntegrationsPage() {
  return (
    <PageShell
      title="Integrations"
      description="Your agents use the tools your business already runs on — Gmail, Slack, Drive, and more."
    >
      <IntegrationsView />
    </PageShell>
  );
}

import { PageShell } from "@/components/page-shell";
import { KnowledgeView } from "@/components/knowledge-view";

export const metadata = {
  title: "Knowledge — Rawgrowth",
};

export default function KnowledgePage() {
  return (
    <PageShell
      title="Knowledge"
      description="Markdown playbooks, SOPs, and brand docs. Tag them so your agents can pull the right context at runtime."
    >
      <KnowledgeView />
    </PageShell>
  );
}

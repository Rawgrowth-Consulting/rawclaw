import { PageShell } from "@/components/page-shell";
import { BlueprintFlow } from "@/components/blueprint-flow";

export default function BlueprintPage() {
  return (
    <PageShell
      title="Blueprint"
      description="How a client goes from onboarding to a fully-running AI operating system — stage by stage."
    >
      <BlueprintFlow />
    </PageShell>
  );
}

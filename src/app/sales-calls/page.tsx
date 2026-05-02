import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { SalesCallUploader } from "@/components/onboarding/SalesCallUploader";

export const dynamic = "force-dynamic";

export default async function SalesCallsPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  return (
    <PageShell
      title="Sales calls"
      description="Drop call recordings (audio/video) or paste Loom/Fireflies/Gong transcripts. Each one gets transcribed (Whisper), chunked, embedded, and added to the company corpus so every agent can reference real objections + closes."
    >
      <SalesCallUploader
        onFinish={() => {
          /* standalone page - no chat handoff needed */
        }}
      />
    </PageShell>
  );
}

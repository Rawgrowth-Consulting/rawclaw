"use client";

import { SalesCallUploader } from "@/components/onboarding/SalesCallUploader";

export function SalesCallsClient() {
  return (
    <SalesCallUploader
      onFinish={() => {
        /* standalone page - no onboarding chat handoff needed */
      }}
    />
  );
}

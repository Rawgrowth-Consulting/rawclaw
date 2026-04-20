"use client";

import { useConfig } from "@/lib/use-config";
import { IntegrationsGrid } from "@/components/integrations-grid";
import { SelfHostedIntegrationsGuide } from "@/components/self-hosted-integrations-guide";

/**
 * Client-side switcher: hosted mode gets the Nango-backed connection grid,
 * self-hosted mode gets the "use your Claude connectors" explainer.
 */
export function IntegrationsView() {
  const { isSelfHosted, loaded } = useConfig();
  if (!loaded) {
    return (
      <div className="text-[12px] text-muted-foreground">Loading…</div>
    );
  }
  return isSelfHosted ? <SelfHostedIntegrationsGuide /> : <IntegrationsGrid />;
}

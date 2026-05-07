"use client";

import useSWR from "swr";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { jsonFetcher } from "@/lib/swr";

type TopRecent = {
  name: string;
  value: number;
  stage: string;
};

type CrmStats = {
  source: string;
  contacts: number;
  deals: number;
  pipelineValue: number;
  topRecent: TopRecent[];
};

// Hard-coded USD because every CRM connector in v3 normalizes amount
// to USD on ingest. Per-org currency lands when multi-currency does.
function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function sourceLabel(source: string): string {
  if (!source) return "CRM";
  if (source === "hubspot") return "HubSpot";
  if (source === "pipedrive") return "Pipedrive";
  if (source === "attio") return "Attio";
  if (source === "close") return "Close";
  return source;
}

export function CrmWidget({ department = "sales" }: { department?: string }) {
  // 30s refresh so a freshly synced deal shows up without a manual
  // reload but we don't hammer the CRM ingest tables either.
  const url = `/api/crm/stats?department=${encodeURIComponent(department)}`;
  const { data, error, isLoading } = useSWR<CrmStats>(url, jsonFetcher, {
    refreshInterval: 30_000,
  });

  if (error) {
    return (
      <Card className="border-border bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-sm">CRM pipeline</CardTitle>
          <CardDescription>Could not load CRM stats.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const empty = !isLoading && data && data.contacts === 0;

  return (
    <Card className="border-border bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm">CRM pipeline</CardTitle>
            <CardDescription>
              {data && data.source
                ? `Synced from ${sourceLabel(data.source)}`
                : "Connect HubSpot, Pipedrive, Attio, or Close to populate."}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Contacts" value={data ? data.contacts : null} />
          <Stat label="Deals" value={data ? data.deals : null} />
          <Stat
            label="Pipeline"
            value={data ? formatMoney(data.pipelineValue) : null}
          />
        </div>

        <div>
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
            Recent deals
          </div>
          {empty ? (
            <div className="text-xs text-muted-foreground">
              No CRM rows yet for this org.
            </div>
          ) : (
            <ul className="divide-y divide-border/50 text-sm">
              {(data?.topRecent ?? []).slice(0, 5).map((row, i) => (
                <li
                  key={`${row.name}-${i}`}
                  className="flex items-center justify-between py-2"
                >
                  <div className="min-w-0 flex-1 truncate pr-3">
                    <div className="truncate text-foreground">{row.name}</div>
                    {row.stage ? (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {row.stage}
                      </div>
                    ) : null}
                  </div>
                  <div className="tabular-nums text-foreground">
                    {row.value > 0 ? formatMoney(row.value) : " - "}
                  </div>
                </li>
              ))}
              {(!data || data.topRecent.length === 0) && !empty ? (
                <li className="py-2 text-xs text-muted-foreground">
                  Loading recent deals…
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number | string | null }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
        {value === null ? " - " : value}
      </div>
    </div>
  );
}

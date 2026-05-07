"use client";

import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { jsonFetcher } from "@/lib/swr";

// Department-context widget row. Mounted on /departments/[slug] above
// the agent list (DepartmentDetailPage). Each pillar gets its own set
// of widgets via /api/dashboard/dept-widgets?slug=<dept>:
//
//   marketing   -> scrape snapshots + recent runs
//   fulfilment  -> open tasks + 7d run counts
//   finance     -> invoice count + rough MRR
//   development -> agents in dept + recent skill changes
//
// Sales is owned by a separate CRM widget (mounted independently). If
// the API returns an empty widgets array we render nothing instead of
// an empty grid.

type Widget = {
  id: string;
  label: string;
  value: string;
  hint: string;
};

type DeptWidgetsResponse = {
  slug: string;
  widgets: Widget[];
};

export function DeptWidgets({ slug }: { slug: string }) {
  const { data } = useSWR<DeptWidgetsResponse>(
    `/api/dashboard/dept-widgets?slug=${encodeURIComponent(slug)}`,
    jsonFetcher,
    { refreshInterval: 30_000 },
  );

  const widgets = data?.widgets ?? [];
  if (data && widgets.length === 0) {
    // Slug has no widgets configured (custom dept, sales, unknown).
    // Render nothing rather than a noisy empty card.
    return null;
  }

  // While loading we show four skeleton placeholders so layout doesn't
  // jump when data lands. We don't know the real count yet so two
  // skeletons is a safe middle ground - matches both 2-widget pillars
  // (marketing / fulfilment / finance / development).
  const display: Widget[] =
    widgets.length > 0
      ? widgets
      : [
          { id: "skel-1", label: " - ", value: " - ", hint: "loading" },
          { id: "skel-2", label: " - ", value: " - ", hint: "loading" },
        ];

  return (
    <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
      {display.map((w) => (
        <Card
          key={w.id}
          className="border-border bg-card/50 backdrop-blur-sm"
        >
          <CardContent className="p-4">
            <div className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
              {w.label}
            </div>
            <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-foreground sm:text-4xl">
              {w.value}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {w.hint}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

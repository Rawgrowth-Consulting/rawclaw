import { DollarSign } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";

const stats = [
  { label: "This month", value: "$0.00", hint: "of $0 budget" },
  { label: "Last month", value: "$0.00", hint: "0 invocations" },
  { label: "Top agent", value: "—", hint: "by spend" },
  { label: "Avg / run", value: "$0.00", hint: "across agents" },
];

export default function CostsPage() {
  return (
    <PageShell
      title="Costs"
      description="Token spend, API usage, and per-agent budgets. Throttled automatically when limits hit."
    >
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Card
            key={s.label}
            className="border-border bg-card/50 backdrop-blur-sm"
          >
            <CardContent className="p-4">
              <div className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
                {s.label}
              </div>
              <div className="mt-2 font-serif text-2xl text-foreground">
                {s.value}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">{s.hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <EmptyState
        icon={DollarSign}
        title="No cost data yet"
        description="Once agents run, we'll track token spend per invocation and roll it up by agent, project, and company."
      />
    </PageShell>
  );
}

import { Settings2, Users, Key, FileInput, FileOutput, Sparkles } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";

const sections = [
  {
    icon: Settings2,
    title: "General",
    description: "Company name, mission, branding, and defaults.",
  },
  {
    icon: Users,
    title: "Access",
    description: "Members, roles, and permissions.",
  },
  {
    icon: Key,
    title: "Invites",
    description: "Pending invites and join requests.",
  },
  {
    icon: Sparkles,
    title: "Skills",
    description: "Capabilities your agents can draw on.",
  },
  {
    icon: FileOutput,
    title: "Export",
    description: "Back up this company and its data.",
  },
  {
    icon: FileInput,
    title: "Import",
    description: "Restore from an earlier export.",
  },
];

export default function CompanyPage() {
  return (
    <PageShell
      title="Company"
      description="Configure the company — access, skills, imports, exports, and defaults."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => (
          <Card
            key={s.title}
            className="group border-border bg-card/50 transition-colors hover:border-primary/30 hover:bg-card"
          >
            <CardContent className="flex items-start gap-3 p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-primary/10 text-primary">
                <s.icon className="size-5" />
              </div>
              <div>
                <div className="text-[14px] font-semibold text-foreground">
                  {s.title}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {s.description}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}

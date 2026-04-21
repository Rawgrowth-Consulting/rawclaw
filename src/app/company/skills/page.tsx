import { SkillsMarketplaceView } from "@/components/skills/skills-marketplace-view";

export const metadata = { title: "Skills — Rawgrowth" };

export default function SkillsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-2xl font-normal tracking-tight text-foreground">
          Skills marketplace
        </h2>
        <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
          Curated RawClaw capabilities your agents can draw on. Pick the skills
          that fit your team, assign them to the agents who need them, and
          install with one command in Claude Code.
        </p>
      </div>
      <SkillsMarketplaceView />
    </div>
  );
}

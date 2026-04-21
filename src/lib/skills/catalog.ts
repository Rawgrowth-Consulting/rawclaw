/**
 * Static catalog of available skills. Curated by operator.
 *
 * Each skill wraps an upstream open-source Claude skill (Vercel, Anthropic,
 * shadcn, etc.) and is rebranded as a "RawClaw" capability. Assignment to
 * agents is per-tenant via rgaios_agent_skills — the catalog itself is
 * global / code-defined.
 */

export type SkillCategory = "engineering" | "design" | "ui" | "ops";

export type Skill = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: SkillCategory;
  // Upstream source (what `npx skills add` will install)
  sourceRepo: string;
  sourceSkill: string;
  // Display
  brand: string;
  iconKey: "rocket" | "palette" | "component" | "wrench";
};

export const SKILLS_CATALOG: Skill[] = [
  {
    id: "rawclaw-react-patterns",
    name: "RawClaw React Patterns",
    tagline: "React + Next.js best practices by Vercel Engineering",
    description:
      "Performance patterns, hooks usage, data fetching, caching, and bundle optimization heuristics. Keeps your React code fast and predictable by default.",
    category: "engineering",
    sourceRepo: "https://github.com/vercel-labs/agent-skills",
    sourceSkill: "vercel-react-best-practices",
    brand: "#60a5fa",
    iconKey: "rocket",
  },
  {
    id: "rawclaw-frontend-design",
    name: "RawClaw Frontend Design",
    tagline: "Anthropic's frontend design playbook",
    description:
      "Distinctive, production-grade UI design. Avoids generic AI aesthetics — creates polished interfaces with strong visual hierarchy and taste.",
    category: "design",
    sourceRepo: "https://github.com/anthropics/skills",
    sourceSkill: "frontend-design",
    brand: "#a78bfa",
    iconKey: "palette",
  },
  {
    id: "rawclaw-ui-shadcn",
    name: "RawClaw UI (shadcn)",
    tagline: "shadcn/ui component library expertise",
    description:
      "Install, compose, and theme shadcn/ui components. Handles CLI, custom registries, Tailwind integration, and accessibility best practices.",
    category: "ui",
    sourceRepo: "https://github.com/shadcn/ui",
    sourceSkill: "shadcn",
    brand: "#0cbf6a",
    iconKey: "component",
  },
];

export function getSkill(id: string): Skill | null {
  return SKILLS_CATALOG.find((s) => s.id === id) ?? null;
}

/**
 * Build the exact install command a client runs in their Claude Code to
 * install a given skill. Returns `null` if the source info is missing.
 */
export function installCommand(skill: Skill): string {
  return `npx skills add ${skill.sourceRepo} --skill ${skill.sourceSkill}`;
}

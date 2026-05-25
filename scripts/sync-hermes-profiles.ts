#!/usr/bin/env tsx
/**
 * sync-hermes-profiles.ts
 *
 * Read every agent row from `rgaios_agents` for the current org and push
 * each one as a Hermes profile via the gateway API. Idempotent — safe to
 * re-run on every agent edit in the dashboard (the upsert call replaces
 * the profile's system_prompt + mcp + skills list).
 *
 * Profile name = lower(agent.name) with non-alphanumerics -> underscore.
 *   "Scan" -> "scan"
 *   "Engineering Manager" -> "engineering_manager"
 *
 * Usage:
 *   ORG_ID=<uuid> tsx scripts/sync-hermes-profiles.ts
 *   ORG_ID=<uuid> tsx scripts/sync-hermes-profiles.ts --dry
 *
 * Required env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   HERMES_GATEWAY_URL, HERMES_API_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { hermesProfiles, type HermesProfileSpec } from "../src/lib/hermes/client";

const dryRun = process.argv.includes("--dry");

async function main() {
  const orgId = process.env.ORG_ID?.trim();
  if (!orgId) {
    console.error("ORG_ID env var is required.");
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required.");
    process.exit(1);
  }
  const supa = createClient(url, key, { auth: { persistSession: false } });

  const { data: agents, error } = await supa
    .from("rgaios_agents")
    .select("id, name, system_prompt, status, department")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("supabase error:", error.message);
    process.exit(1);
  }
  if (!agents || agents.length === 0) {
    console.warn("no agents found for org", orgId);
    return;
  }

  const existing = dryRun
    ? []
    : await hermesProfiles
        .list()
        .catch((e) => {
          console.warn("could not list existing profiles:", e);
          return [] as { name: string }[];
        });

  console.log(`syncing ${agents.length} agents -> Hermes profiles`);
  for (const agent of agents as Array<{
    id: string;
    name: string;
    system_prompt: string | null;
    status: string | null;
    department: string | null;
  }>) {
    if (agent.status === "paused") {
      console.log(`  skip ${agent.name} (paused)`);
      continue;
    }
    const profile: HermesProfileSpec = {
      name: toProfileName(agent.name),
      system_prompt: agent.system_prompt ?? "",
      mcp_servers: ["composio"],
      // Default skills + dept-specific extras can be added here later
      skills: defaultSkillsForDepartment(agent.department),
    };

    if (dryRun) {
      console.log(
        `  [dry] upsert ${profile.name} (prompt: ${profile.system_prompt.length} chars)`,
      );
      continue;
    }

    try {
      await hermesProfiles.upsert(profile);
      const verb = existing.some((p) => p.name === profile.name)
        ? "updated"
        : "created";
      console.log(`  ${verb} ${profile.name}`);
    } catch (err) {
      console.error(`  failed ${profile.name}:`, err);
    }
  }
}

function toProfileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function defaultSkillsForDepartment(dept: string | null): string[] {
  // The 89 bundled Hermes skills cover most generic ops. Department
  // hints here enable a small curated subset per role; the agent can
  // still load others via `/skills` at runtime.
  const base = [
    "web-search-scraping",
    "file-operations",
    "memory",
    "todo",
    "delegate-task",
  ];
  switch ((dept ?? "").toLowerCase()) {
    case "marketing":
      return [...base, "image-generation", "trending-content-detection"];
    case "sales":
      return [...base, "lead-audit", "sales-closer"];
    case "customer-service":
      return [...base, "slack-respond"];
    case "ceo":
      return [...base, "morning-brief", "dash-dashboard"];
    case "recruitment":
      return [...base, "hunter-recruitment", "headhunter-agent"];
    case "development":
      return [...base, "code-execution", "node-inspect-debugger"];
    default:
      return base;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createAgent, listAgentsForOrg } from "@/lib/agents/queries";
import { DEFAULT_AGENT_RUNTIME } from "@/lib/agents/constants";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { getRoleTemplate } from "@/lib/agents/role-templates";
import { ingestAgentFile } from "@/lib/knowledge/ingest";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const agents = await listAgentsForOrg((await currentOrganizationId()));
    return NextResponse.json({ agents });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orgId = await currentOrganizationId();
    const roleLabel = typeof body.role === "string" ? body.role.trim() : "";
    const template = getRoleTemplate(roleLabel);

    const agent = await createAgent(orgId, {
      name: String(body.name ?? "").trim(),
      title: String(body.title ?? "").trim(),
      role: body.role,
      reportsTo: body.reportsTo ?? null,
      description: String(body.description ?? "").trim(),
      runtime: body.runtime ?? DEFAULT_AGENT_RUNTIME,
      budgetMonthlyUsd: Number(body.budgetMonthlyUsd ?? 500),
      writePolicy:
        body.writePolicy &&
        typeof body.writePolicy === "object" &&
        !Array.isArray(body.writePolicy)
          ? body.writePolicy
          : undefined,
      department: body.department ?? null,
      isDepartmentHead: body.isDepartmentHead ?? false,
    });

    // Plan §3 + §4. If a role template matched, fan out auto-train work
    // post-create. Each step is best-effort + logged - never fails the
    // agent-create response. Caller still gets an agent row even if
    // starter docs don't ingest cleanly.
    if (template) {
      try {
        await supabaseAdmin()
          .from("rgaios_agents")
          .update({ system_prompt: template.systemPrompt })
          .eq("id", agent.id)
          .eq("organization_id", orgId);
      } catch (err) {
        console.warn(`[hire] failed to set system_prompt for ${agent.id}: ${(err as Error).message}`);
      }

      if (template.defaultSkillIds.length > 0) {
        try {
          const rows = template.defaultSkillIds.map((skillId) => ({
            organization_id: orgId,
            agent_id: agent.id,
            skill_id: skillId,
          }));
          await supabaseAdmin()
            .from("rgaios_agent_skills")
            .upsert(rows, { onConflict: "organization_id,agent_id,skill_id", ignoreDuplicates: true });
        } catch (err) {
          console.warn(`[hire] failed to attach skills for ${agent.id}: ${(err as Error).message}`);
        }
      }

      const starterRoot = join(process.cwd(), "src/lib/agents/starter-content");
      for (const starter of template.starterFiles) {
        try {
          const filePath = join(starterRoot, starter.relativePath);
          const content = await readFile(filePath, "utf8");
          await ingestAgentFile({
            orgId,
            agentId: agent.id,
            filename: starter.filename,
            content,
            mimeType: "text/markdown",
            uploadedBy: null,
            storage: null,
          });
        } catch (err) {
          console.warn(`[hire] starter file ${starter.relativePath} failed for ${agent.id}: ${(err as Error).message}`);
        }
      }
    }

    return NextResponse.json({ agent }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

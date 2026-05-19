import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { getMe, setWebhook } from "@/lib/telegram/client";
import { encryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

/**
 * CEO-only Telegram bot wiring.
 *
 * GET  /api/connections/agent-telegram
 *      → list the bot for this org (at most one).
 *
 * POST /api/connections/agent-telegram
 *      Body: { agent_id: string, token: string }
 *      → validate the token via getMe, register the webhook back to
 *        /api/webhooks/agent-telegram/[bot_row_id], persist encrypted
 *        token. Agent must be the CEO department head.
 *
 * Pedro 2026-05-19 mandate: one bot per organization, attached to
 * the CEO agent only. CEO receives every DM and orchestrates via
 * agent_invoke (delegates to Marta / Kasia / Ania / Zosia / Basia /
 * Engineering Manager as needed). Per-agent bots are an anti-pattern
 * that splits the customer-facing surface and lets sub-agents skip
 * the orchestration step. DB-side enforcement lives in migration
 * 0080_one_ceo_bot_per_org.sql (UNIQUE INDEX on organization_id +
 * trigger that requires is_department_head=true and department='ceo').
 */

export async function GET() {
  const organizationId = await currentOrganizationId();
  const { data, error } = await supabaseAdmin()
    .from("rgaios_agent_telegram_bots")
    .select(
      `id, agent_id, bot_id, bot_username, bot_first_name, status, created_at,
       rgaios_agents!inner ( id, name, title, department )`,
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ bots: data ?? [] });
}

export async function POST(req: NextRequest) {
  try {
    const { agent_id, token } = (await req.json()) as {
      agent_id?: string;
      token?: string;
    };
    if (!agent_id || typeof agent_id !== "string") {
      return NextResponse.json(
        { error: "agent_id is required" },
        { status: 400 },
      );
    }
    if (!token || !token.includes(":")) {
      return NextResponse.json(
        { error: "Invalid bot token format" },
        { status: 400 },
      );
    }

    const organizationId = await currentOrganizationId();
    const db = supabaseAdmin();

    // Agent must exist + belong to this org + be the CEO department
    // head (is_department_head=true AND department='ceo'). Pedro
    // 2026-05-19 mandate: one bot per org, CEO-only. Sub-agents and
    // non-CEO department heads are rejected here AND by the DB trigger
    // in 0080_one_ceo_bot_per_org.sql. Belt-and-suspenders: the route
    // returns a friendly 400, the DB rejects insert if the route is
    // ever bypassed.
    type AgentRoleRow = {
      id: string;
      name: string;
      is_department_head: boolean | null;
      department: string | null;
    };
    const { data: agentData } = await db
      .from("rgaios_agents")
      .select("id, name, is_department_head, department")
      .eq("id", agent_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    // supabase-js collapses .maybeSingle() row inference to `never` here;
    // the select lists only real columns, so a narrow typed cast is safe.
    const agent = (agentData as AgentRoleRow | null) ?? null;
    if (!agent) {
      return NextResponse.json(
        { error: "Agent not found" },
        { status: 404 },
      );
    }
    const isCeo =
      agent.is_department_head === true && agent.department === "ceo";
    if (!isCeo) {
      return NextResponse.json(
        {
          error:
            "Telegram bot wiring is reserved for the CEO agent. Mark this agent as the CEO department head (is_department_head=true, department='ceo') first. CEO orchestrates to other agents via agent_invoke.",
        },
        { status: 400 },
      );
    }

    // Validate the token resolves to a real bot.
    const me = await getMe(token);
    if (!me.is_bot) {
      return NextResponse.json(
        { error: "Token did not resolve to a bot" },
        { status: 400 },
      );
    }

    const webhookSecret = crypto.randomBytes(24).toString("hex");

    // Upsert by agent_id (unique constraint) — replacing the bot for an
    // existing head is a clean operation, not an error.
    const { data: row, error: upsertErr } = await db
      .from("rgaios_agent_telegram_bots")
      .upsert(
        {
          organization_id: organizationId,
          agent_id,
          bot_id: me.id,
          bot_username: me.username ?? null,
          bot_first_name: me.first_name,
          bot_token: encryptSecret(token),
          // Encrypted at rest; webhook handler decrypts + timingSafeEquals.
          webhook_secret: encryptSecret(webhookSecret),
          status: "connected",
          metadata: {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "agent_id" },
      )
      .select("id")
      .single();
    if (upsertErr || !row) {
      return NextResponse.json(
        { error: upsertErr?.message ?? "Persist failed" },
        { status: 500 },
      );
    }

    // Register the webhook with Telegram. URL = our app + per-row id, so
    // multiple bots in the same org route to the same code path with a
    // different scope.
    const origin = (
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.NEXTAUTH_URL ??
      new URL(req.url).origin
    ).replace(/\/$/, "");
    const webhookUrl = `${origin}/api/webhooks/agent-telegram/${row.id}`;
    try {
      await setWebhook(token, webhookUrl, webhookSecret);
    } catch (whErr) {
      const message = (whErr as Error).message;
      await db
        .from("rgaios_agent_telegram_bots")
        .update({
          status: "error",
          metadata: { last_error: message },
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      return NextResponse.json(
        { error: "Webhook registration failed - operator needs to retry" },
        { status: 502 },
      );
    }

    await db.from("rgaios_audit_log").insert({
      organization_id: organizationId,
      kind: "connection_connected",
      actor_type: "system",
      actor_id: "agent-telegram",
      detail: {
        agent_id,
        agent_name: agent.name,
        bot: me.username ?? me.first_name,
        webhookUrl,
      },
    });

    return NextResponse.json({
      ok: true,
      bot_row_id: row.id,
      bot: { id: me.id, username: me.username, first_name: me.first_name },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

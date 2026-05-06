import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { ingestCompanyChunk } from "@/lib/knowledge/company-corpus";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/data/ingest
 *
 * Manual data entry into the company corpus. The operator pastes
 * structured data (CRM contact, deal, note, or arbitrary text) and
 * we chunk + embed it into rgaios_company_chunks so every agent can
 * search/cite it via the company_corpus RAG path.
 *
 * Body: { source: "crm_contact" | "crm_deal" | "note" | "other",
 *         label: string, text: string, metadata?: object }
 */
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    source?: unknown;
    label?: unknown;
    text?: unknown;
    metadata?: unknown;
  };

  // Strict type checks - the chunker downstream casts to string and
  // tokenises; passing a non-string trips a 500 with empty body.
  if (typeof body.text !== "string") {
    return NextResponse.json(
      { error: "text is required (string, 10+ chars)" },
      { status: 400 },
    );
  }
  const text = body.text.trim();
  if (text.length < 10) {
    return NextResponse.json(
      { error: "text is required (10+ chars)" },
      { status: 400 },
    );
  }
  // Cap input at 1 MB so the embedder can't be made to OOM by a giant
  // body (Pedro: explicit 1 MB cap from the brief).
  if (text.length > 1_000_000) {
    return NextResponse.json(
      { error: "text exceeds 1 MB limit" },
      { status: 413 },
    );
  }
  const source =
    typeof body.source === "string" && body.source.trim()
      ? body.source.trim().slice(0, 64)
      : "manual_entry";
  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, 200)
      : "manual entry";
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};

  const result = await ingestCompanyChunk({
    orgId: ctx.activeOrgId,
    source,
    sourceId: null,
    text,
    metadata: {
      label,
      entered_by: ctx.userId ?? "unknown",
      entered_at: new Date().toISOString(),
      ...metadata,
    },
  });

  await supabaseAdmin().from("rgaios_audit_log").insert({
    organization_id: ctx.activeOrgId,
    kind: "data_ingested",
    actor_type: "user",
    actor_id: ctx.userId ?? "unknown",
    detail: {
      source,
      label,
      chunks: result.chunkCount,
      tokens: result.tokenCount,
    },
  } as never);

  return NextResponse.json({
    ok: true,
    chunks: result.chunkCount,
    tokens: result.tokenCount,
  });
}

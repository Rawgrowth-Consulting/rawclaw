import { matchCompanyChunks } from "@/lib/knowledge/company-corpus";
import { registerTool, text, textError } from "../registry";

/**
 * company_query  -  top-K retrieval over the org-wide company corpus
 * (rgaios_company_chunks, plan §7). Distinct from knowledge_query
 * which is per-agent. Sources unioned in the corpus: intake answers,
 * brand profile markdown, scrape snapshots, onboarding documents,
 * sales calls.
 *
 * Used by:
 *   - the CEO agent (plan §10) to ground cross-department briefs
 *   - any agent that wants company-wide grounding before a reply
 *   - the brand-page "what we know about you" panel via /api/mcp
 */

registerTool({
  name: "company_query",
  description:
    "Semantic search across the entire company corpus (intake answers, " +
    "brand profile, scrape snapshots, onboarding docs, sales calls). " +
    "Returns top-K chunks with source labels so the caller can cite " +
    "where each fact came from. Use this when the question asks about " +
    "the customer's business as a whole, not just one agent's files.",
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string", description: "Natural-language search prompt." },
      k: {
        type: "number",
        description: "Chunks to return (default 5, max 25).",
      },
    },
  },
  handler: async (args, ctx) => {
    const query = String(args.query ?? "").trim();
    const k = Math.min(Math.max(Number(args.k ?? 5) || 5, 1), 25);

    if (!query) return textError("query is required.");

    let matches;
    try {
      matches = await matchCompanyChunks(ctx.organizationId, query, k);
    } catch (err) {
      return textError(`company_query failed: ${(err as Error).message}`);
    }

    if (matches.length === 0) {
      return text(
        `No matches found in the company corpus for: ${query}\n\nThe corpus is empty or no chunks crossed the similarity threshold. If onboarding finished, the brand profile + intake should be there - check that ingest jobs ran.`,
      );
    }

    const lines = [
      `Top ${matches.length} match${matches.length === 1 ? "" : "es"} for: ${query}`,
      "",
      ...matches.map((m, i) => {
        const score = (m.similarity * 100).toFixed(1);
        const head = `[${i + 1}] ${m.source}${m.sourceId ? ` (${m.sourceId.slice(0, 8)})` : ""} - similarity ${score}%`;
        const body = m.chunkText.slice(0, 600).replace(/\n+/g, " ");
        return `${head}\n${body}`;
      }),
    ];
    return text(lines.join("\n\n"));
  },
});

export const COMPANY_KNOWLEDGE_TOOLS_REGISTERED = true;

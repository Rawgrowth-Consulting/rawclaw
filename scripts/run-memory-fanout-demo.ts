#!/usr/bin/env tsx
/**
 * Demo: fan-out write across the 4-tier memory chain + read back merged.
 *
 * Proves the writeMemory / readMemory chain end to end. With
 * MEMORY_TIERS=hermes,honcho,mem0,letta, a single writeMemory(turn)
 * fires four parallel writes (one per tier), each tier's write returns
 * its own id, then readMemory({query}) fans out the search and
 * concatenates snippets from every tier that returned data.
 *
 * Expected on Admin VPS (with Honcho + mem0 + Letta + Ollama live):
 *   - Honcho: writes a message under workspace `rgaios_<orgId>` peer
 *     `<userId|agent_xxx>` session `<session>`, persists in Postgres.
 *   - mem0: extracts facts via llama3.2:1b, embeds via nomic-embed-text,
 *     stores point in qdrant (768 dim).
 *   - Letta: appends to archival memory of the per-(org, agent, user)
 *     Letta agent.
 *   - Hermes local: no-op writer (Hermes writes its own state.db on each
 *     /api/ws turn); read pulls recent /api/sessions/{id}/messages.
 *
 * Usage:
 *   MEMORY_TIERS=hermes,honcho,mem0,letta \
 *   HONCHO_BASE_URL=http://localhost:8001 \
 *   MEM0_BASE_URL=http://localhost:8765 \
 *   LETTA_BASE_URL=http://localhost:8283 \
 *   LETTA_PASSWORD=letta_admin_token \
 *   tsx scripts/run-memory-fanout-demo.ts
 */

import { writeMemory, readMemory, getMemoryTiers } from "../src/lib/memory";

async function main() {
  const tiers = getMemoryTiers();
  console.log(`tiers enabled: ${tiers.map((t) => t.name).join(", ")}`);

  const turn = {
    organizationId: "smoke",
    agentId: "scan",
    userId: "rawclaw",
    session: "demo",
    role: "user" as const,
    content: `Pedro is testing the four-tier memory chain at ${new Date().toISOString()}. Marti likes pizza on Sundays.`,
    metadata: { source: "run-memory-fanout-demo" },
  };

  console.log("\n=== fan-out write ===");
  console.log(`turn.content: ${turn.content}`);
  const tw = Date.now();
  await writeMemory(turn);
  console.log(`write done in ${Date.now() - tw}ms (mem0 step may have queued LLM extraction in the background)`);

  // Give the slower tiers (mem0 LLM fact extraction on llama3.2:1b CPU
  // takes ~90s on a CPX21) some time to land before reading back.
  await new Promise((r) => setTimeout(r, 5000));

  console.log("\n=== fan-out read ===");
  const tr = Date.now();
  const snippets = await readMemory({
    organizationId: turn.organizationId,
    agentId: turn.agentId,
    userId: turn.userId,
    session: turn.session,
    query: "What did Pedro test? What does Marti like?",
    limit: 5,
  });
  console.log(`read done in ${Date.now() - tr}ms; ${snippets.length} snippets:`);
  for (const s of snippets) {
    const c = s.content.length > 120 ? s.content.slice(0, 120) + "..." : s.content;
    console.log(`  [${s.source}] ${c} ${s.score != null ? `(score=${s.score.toFixed(3)})` : ""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

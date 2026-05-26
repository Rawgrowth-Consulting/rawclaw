#!/usr/bin/env tsx
/**
 * Demo: chatReplySelfHealingLearning end-to-end.
 *
 * Sends two consecutive turns through the self-healing/learning chat
 * pipeline so we can observe:
 *
 *   Turn 1 — no memory yet, first attempt either succeeds (no repair
 *            needed) or fails (repair loop runs N cycles via autoresearch).
 *   Turn 2 — same user, follow-up question. Should see "learned=N"
 *            snippets in the merged extraPreamble because turn 1 wrote
 *            user+assistant content into every enabled memory tier.
 *
 * Run on Admin (where Hermes + Honcho + mem0 + Letta + Ollama all live):
 *
 *   CHAT_ENGINE=hermes-self-heal \
 *   MEMORY_TIERS=hermes,honcho,mem0,letta \
 *   HONCHO_BASE_URL=http://localhost:8001 \
 *   MEM0_BASE_URL=http://localhost:8765 \
 *   LETTA_BASE_URL=http://localhost:8283 \
 *   LETTA_PASSWORD=letta_admin_token \
 *   HERMES_DASHBOARD_URL=http://localhost:9119 \
 *   tsx scripts/run-self-heal-demo.ts
 */

import { chatReplySelfHealingLearning } from "../src/lib/hermes/self-healing";

const ORG = process.env.SMOKE_ORG_ID ?? "smoke";
const CHAT_BASE = Date.now();

async function turn(label: string, userMessage: string) {
  const t0 = Date.now();
  const r = await chatReplySelfHealingLearning({
    organizationId: ORG,
    organizationName: "Self-heal smoke",
    chatId: CHAT_BASE + (label === "1" ? 0 : 1),
    userMessage,
    publicAppUrl: "http://localhost:3000",
    agentId: "scan",
    callerUserId: "pedro",
  });
  const ms = Date.now() - t0;
  if (!r.ok) {
    console.log(`turn ${label} FAILED in ${ms}ms: ${r.error}`);
    return;
  }
  const tag =
    [
      r.healed ? `healed(cycles=${r.cycles ?? "?"})` : "",
      r.learned != null ? `learned=${r.learned}` : "",
    ]
      .filter(Boolean)
      .join(" ") || "clean";
  console.log(`turn ${label} OK in ${ms}ms [${tag}]`);
  console.log(`  reply: ${r.reply.slice(0, 220)}${r.reply.length > 220 ? "..." : ""}`);
}

async function main() {
  console.log(`org=${ORG} chatBase=${CHAT_BASE}`);
  console.log("\n=== turn 1 (cold, no memory yet) ===");
  await turn("1", "I am Pedro at Rawgrowth. My favorite color is blue.");

  // Give the slower tiers (mem0 LLM fact extraction on CPU) time to land.
  console.log("\nsleeping 8s so mem0 fact extraction can finish...");
  await new Promise((r) => setTimeout(r, 8000));

  console.log("\n=== turn 2 (warm, expects to read prior turn from memory) ===");
  await turn("2", "Quick check — what's my favorite color and where do I work?");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

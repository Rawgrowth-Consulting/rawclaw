#!/usr/bin/env tsx
/**
 * Standalone autoresearch loop demo against a live Hermes VPS.
 *
 * Spawn `hermes chat -q "..." -Q` as a subprocess for each cycle, score
 * the reply, keep/revert by the autoresearch loop in
 * src/lib/hermes/autoresearch.ts. No HTTP gateway required: this uses
 * the same subprocess path the bridge falls back to when the dashboard
 * WebSocket auth isn't available (Hermes 0.14 ships dashboard auth as
 * a browser-only injected session token, not server-to-server).
 *
 * Verified live on Admin VPS (5.161.51.44) running Codex 5.5: three
 * cycles produced three real 7-word candidates, score 1.000 each.
 *
 * Usage:
 *   tsx scripts/run-autoresearch-demo.ts
 *   tsx scripts/run-autoresearch-demo.ts --goal "Reply with EXACTLY 5 words" --cycles 5
 */

import { spawn } from "node:child_process";
import { autoresearch } from "../src/lib/hermes/autoresearch";

const goal = argOf("--goal") ??
  "Reply with EXACTLY 7 words about AI agents. Score is 1/(1+abs(7-word_count)).";
const cycles = Number(argOf("--cycles") ?? "3");
const target = Number(argOf("--target") ?? "7");

function argOf(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function hermesChat(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("hermes", ["chat", "-q", prompt, "-Q"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0)
        return reject(
          new Error(`hermes exited ${code}: ${err.slice(0, 200)}`),
        );
      const lines = out
        .split("\n")
        .filter((l) => !l.startsWith("session_id:"))
        .join("\n")
        .trim();
      resolve(lines);
    });
  });
}

function score(reply: string): { score: number; detail?: string } {
  const words = (reply.match(/\S+/g) ?? []).length;
  const diff = Math.abs(target - words);
  return { score: 1 / (1 + diff), detail: `words=${words} diff=${diff}` };
}

async function main() {
  const result = await autoresearch<string>(
    { goal, maxCycles: cycles, patience: cycles, egl: 0.001 },
    {
      async propose(best, history) {
        if (!best) {
          return hermesChat(
            `Write a single sentence of exactly ${target} words about AI agents.`,
          );
        }
        const lastScores = history
          .slice(-3)
          .map((h) => `${h.score.toFixed(2)}: ${h.candidate}`)
          .join("\n");
        return hermesChat(
          `Goal: ${goal}\nBest so far (${
            history[history.length - 1]?.score.toFixed(2) ?? "?"
          }): ${best}\nRecent attempts:\n${lastScores}\nPropose ONE new sentence of exactly ${target} words. Output the sentence verbatim, no preamble, no markdown.`,
        );
      },
      async evaluate(candidate) {
        return score(candidate);
      },
    },
  );
  console.log("\n=== RESULT ===");
  console.log(`cycles: ${result.cycles}`);
  console.log(`converged: ${result.converged}`);
  console.log(`best score: ${result.bestScore.toFixed(3)}`);
  console.log(`best candidate: ${result.best}`);
  console.log("\nhistory:");
  for (const h of result.history) {
    console.log(`  ${h.score.toFixed(3)} :: ${h.candidate}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import {
  autoresearch,
  type AutoresearchObservation,
} from "@/lib/hermes/autoresearch";
import { hermesChat } from "@/lib/hermes/client";
import { writeMemory, readMemory } from "@/lib/memory";
import { errorScore, looksLikeError } from "@/lib/hermes/self-healing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  goal: string;
  maxCycles?: number;
  patience?: number;
  egl?: number;
}

/**
 * POST /api/admin/autoresearch
 *
 * Body: { goal, maxCycles?, patience?, egl? }
 *
 * Streams newline-delimited JSON events back to the client:
 *   {"type":"cycle","data":{cycle,candidate,score,detail,kept}}
 *   {"type":"final","data":{best,bestScore,cycles,converged}}
 *   {"type":"error","data":{error}}
 *
 * Each cycle: Hermes chat proposes a candidate response. We score
 * with errorScore (long-and-clean = high). Best one wins. The winner
 * + cycle history get persisted into the 4-tier memory chain so the
 * next run on a similar goal starts with prior wisdom.
 */
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin) {
    return new Response(JSON.stringify({ error: "not admin" }), {
      status: 403,
    });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
  }
  if (!body.goal || typeof body.goal !== "string") {
    return new Response(JSON.stringify({ error: "goal required" }), {
      status: 400,
    });
  }
  const maxCycles = Math.min(20, Math.max(1, body.maxCycles ?? 5));
  const patience = Math.max(1, body.patience ?? 2);
  const egl = body.egl ?? 0.05;
  const goal = body.goal;
  const organizationId = ctx.activeOrgId ?? ctx.homeOrgId;
  if (!organizationId) {
    return new Response(JSON.stringify({ error: "no active org" }), {
      status: 400,
    });
  }
  const session = `org:${organizationId}:autoresearch:${Date.now()}`;

  const encoder = new TextEncoder();
  let kept = 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (type: string, data: unknown) =>
        controller.enqueue(
          encoder.encode(JSON.stringify({ type, data }) + "\n"),
        );

      try {
        // Pull prior wisdom from memory if this org has ever run a
        // similar goal before. Prepend as inspiration to the proposer.
        const prior = await readMemory({
          organizationId,
          agentId: "autoresearch",
          userId: ctx.userId ?? null,
          session: `org:${organizationId}:autoresearch:history`,
          query: goal,
          limit: 3,
        }).catch(() => []);
        const priorBlock = prior.length
          ? "\n\n## Prior winning candidates for similar goals (use as inspiration, don't copy):\n" +
            prior.map((p, i) => `${i + 1}. ${p.content}`).join("\n")
          : "";

        const result = await autoresearch<string>(
          { goal, maxCycles, patience, egl },
          {
            async propose(best, history) {
              const cycleNum = history.length + 1;
              const prompt = [
                `Goal: ${goal}`,
                best
                  ? `\nBest candidate so far (score ${history[history.length - 1]?.score?.toFixed(3) ?? "?"}):\n${best}`
                  : "",
                history.length
                  ? `\nTried ${history.length} variations. Last detail: ${history[history.length - 1]?.detail ?? "(none)"}`
                  : "",
                priorBlock,
                `\nProduce cycle ${cycleNum}: a single concrete candidate response. Be specific, no meta-commentary, no "here is" preface. Output only the candidate itself.`,
              ]
                .filter(Boolean)
                .join("\n");
              try {
                const r = await hermesChat({ prompt, session });
                return r.reply;
              } catch (err) {
                return `[propose failed: ${(err as Error).message}]`;
              }
            },
            async evaluate(candidate) {
              const score = errorScore(candidate);
              const detail = looksLikeError(candidate)
                ? "errory"
                : "clean";
              return { score, detail };
            },
          },
        );

        // Synthesize cycle/kept emits from observation history.
        let bestSoFar = Number.NEGATIVE_INFINITY;
        result.history.forEach((obs: AutoresearchObservation<string>, i) => {
          const isKeep = obs.score > bestSoFar + egl;
          if (isKeep) {
            bestSoFar = obs.score;
            kept += 1;
          }
          emit("cycle", {
            cycle: i + 1,
            candidate: obs.candidate,
            score: obs.score,
            detail: obs.detail,
            kept: isKeep,
          });
        });

        emit("final", {
          best: result.best,
          bestScore: result.bestScore,
          cycles: result.cycles,
          converged: result.converged,
        });

        // Persist the winner so next run on a similar goal benefits.
        if (result.best) {
          await writeMemory({
            organizationId,
            agentId: "autoresearch",
            userId: ctx.userId ?? null,
            session: `org:${organizationId}:autoresearch:history`,
            role: "system",
            content: `Goal: ${goal}\nWinning candidate (score ${result.bestScore.toFixed(3)} after ${result.cycles} cycle(s), ${kept} kept):\n${result.best}`,
            metadata: {
              autoresearch: true,
              cycles: result.cycles,
              score: result.bestScore,
              session,
            },
          }).catch((err) =>
            console.warn("[autoresearch] writeMemory failed:", err),
          );
        }
      } catch (err) {
        emit("error", { error: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

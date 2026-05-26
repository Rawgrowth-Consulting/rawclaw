"use client";

import { useCallback, useRef, useState } from "react";

interface CycleEvent {
  cycle: number;
  candidate: string;
  score: number;
  detail?: string;
  kept: boolean;
}

interface FinalEvent {
  best: string | null;
  bestScore: number;
  cycles: number;
  converged: boolean;
}

type StreamEvent =
  | { type: "cycle"; data: CycleEvent }
  | { type: "final"; data: FinalEvent }
  | { type: "error"; data: { error: string } };

export function AutoresearchClient() {
  const [goal, setGoal] = useState(
    "Write a single-sentence client-facing reply that does not contain any banned brand words and reads as warm and direct.",
  );
  const [maxCycles, setMaxCycles] = useState(5);
  const [running, setRunning] = useState(false);
  const [cycles, setCycles] = useState<CycleEvent[]>([]);
  const [finalResult, setFinalResult] = useState<FinalEvent | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setCycles([]);
    setFinalResult(null);
    setErrorMsg(null);
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/admin/autoresearch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, maxCycles }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line) as StreamEvent;
            if (ev.type === "cycle") setCycles((prev) => [...prev, ev.data]);
            else if (ev.type === "final") setFinalResult(ev.data);
            else if (ev.type === "error") setErrorMsg(ev.data.error);
          } catch (parseErr) {
            console.warn("bad line", line, parseErr);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setErrorMsg((err as Error).message);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [goal, maxCycles]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-sm font-medium">Goal</label>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          className="w-full rounded border border-gray-300 p-2 font-mono text-sm"
          disabled={running}
        />
      </div>
      <div className="flex items-center gap-3">
        <label className="text-sm">Max cycles</label>
        <input
          type="number"
          min={1}
          max={20}
          value={maxCycles}
          onChange={(e) => setMaxCycles(Number(e.target.value) || 5)}
          className="w-20 rounded border border-gray-300 p-2 text-sm"
          disabled={running}
        />
        {running ? (
          <button
            onClick={cancel}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={run}
            disabled={!goal.trim()}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Run loop
          </button>
        )}
        {running && <span className="text-sm text-gray-500">running...</span>}
      </div>

      {errorMsg && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      {cycles.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium">Cycles ({cycles.length})</div>
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-2">#</th>
                <th className="p-2">Score</th>
                <th className="p-2">Kept</th>
                <th className="p-2">Detail</th>
                <th className="p-2">Candidate</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => (
                <tr key={c.cycle} className="border-t border-gray-200">
                  <td className="p-2 font-mono">{c.cycle}</td>
                  <td className="p-2 font-mono">{c.score.toFixed(3)}</td>
                  <td className="p-2">{c.kept ? "✓" : ""}</td>
                  <td className="p-2 text-xs text-gray-600">
                    {c.detail ?? ""}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {c.candidate.length > 160
                      ? c.candidate.slice(0, 160) + "…"
                      : c.candidate}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {finalResult && (
        <div className="rounded border border-green-300 bg-green-50 p-3">
          <div className="text-sm font-medium">
            Final{" "}
            <span className="font-mono">
              cycles={finalResult.cycles} bestScore=
              {finalResult.bestScore.toFixed(3)}{" "}
              {finalResult.converged ? "(converged)" : ""}
            </span>
          </div>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">
            {finalResult.best ?? "(no candidate)"}
          </pre>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type SuggestedAgent = {
  role: string;
  why: string;
  starterFiles: string[];
};

type AnalyzeResponse = {
  ok?: boolean;
  summary?: string;
  painPoints?: string[];
  gaps?: string[];
  suggestedAgents?: SuggestedAgent[];
  createdAgentIds?: string[];
  error?: string;
};

/**
 * Paste-and-analyze surface. Single textarea + Analyze button + four
 * result blocks. We deliberately keep the whole flow on the client side
 * so the operator can iterate without a page reload: paste, analyze,
 * tweak the transcript, re-analyze. Server-side Plan §12 wiring lives
 * in /api/audit-call.
 */
export function AuditCallClient() {
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  async function analyze() {
    const text = transcript.trim();
    if (!text) {
      toast.error("Paste a transcript first.");
      return;
    }
    if (busy) return;
    setBusy(true);
    const toastId = toast.loading("Analyzing transcript...");
    try {
      const res = await fetch("/api/audit-call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: text, source: "audit_call_paste" }),
      });
      const body = (await res.json()) as AnalyzeResponse;
      if (!res.ok || body.ok === false) {
        toast.error(body.error ?? "Analysis failed", { id: toastId });
        setResult(body);
        return;
      }
      const drafts = body.createdAgentIds?.length ?? 0;
      toast.success(
        drafts > 0
          ? `Done - saved ${drafts} draft agent${drafts === 1 ? "" : "s"}.`
          : "Analysis ready.",
        { id: toastId },
      );
      setResult(body);
    } catch (err) {
      toast.error((err as Error).message ?? "Network error", { id: toastId });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label
          htmlFor="audit-call-transcript"
          className="text-sm font-medium text-zinc-200"
        >
          Transcript
        </label>
        <Textarea
          id="audit-call-transcript"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Paste the raw transcript here. Speaker labels, timestamps, and filler words are fine - the LLM normalises them."
          className="min-h-[260px] font-mono text-xs"
          disabled={busy}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-zinc-500">
            {transcript.length.toLocaleString()} chars
          </span>
          <Button onClick={analyze} disabled={busy} size="sm">
            {busy ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 size-3.5" />
            )}
            {busy ? "Analyzing..." : "Analyze"}
          </Button>
        </div>
      </div>

      {result?.ok ? <ResultBlocks result={result} /> : null}
    </div>
  );
}

function ResultBlocks({ result }: { result: AnalyzeResponse }) {
  const summary = result.summary ?? "";
  const painPoints = result.painPoints ?? [];
  const gaps = result.gaps ?? [];
  const agents = result.suggestedAgents ?? [];

  return (
    <div className="grid gap-4">
      {summary ? (
        <section className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
          <h3 className="text-sm font-semibold text-zinc-200">
            Company summary
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">
            {summary}
          </p>
        </section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <ListBlock title="Pain points" items={painPoints} />
        <ListBlock title="Gaps" items={gaps} />
      </div>

      {agents.length > 0 ? (
        <section className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
          <h3 className="text-sm font-semibold text-zinc-200">
            Suggested agents
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Saved as drafts. Promote them from /agents.
          </p>
          <ul className="mt-3 space-y-3">
            {agents.map((a, i) => (
              <li
                key={`${a.role}-${i}`}
                className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3"
              >
                <div className="text-sm font-medium text-zinc-100">
                  {a.role}
                </div>
                {a.why ? (
                  <p className="mt-1 text-xs text-zinc-400">{a.why}</p>
                ) : null}
                {a.starterFiles.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {a.starterFiles.map((f) => (
                      <span
                        key={f}
                        className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
      <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, i) => (
          <li
            key={`${title}-${i}`}
            className="text-sm text-zinc-300 before:mr-2 before:content-['-']"
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

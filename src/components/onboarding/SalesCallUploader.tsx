"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Upload, Link2, Check, AlertCircle, X, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Inline sales-call uploader rendered mid-onboarding (Plan §12). Two
 * intake shapes:
 *   - Audio drop  -  mp3/m4a/webm/ogg/wav. POSTs multipart to
 *     /api/onboarding/sales-calls/upload, server runs Whisper, chunks
 *     + embeds the transcript into the company corpus.
 *   - URL paste  -  Loom/Fireflies/Gong link. POSTs JSON `{url}`. The
 *     server records the row but URL-source ingestion isn't fully
 *     wired yet; the UI surfaces the pending status so the operator
 *     can revisit.
 *
 * Mirrors BrandDocsUploader's UX: drag-drop zone + list of uploads
 * with status badges, plus a Continue/Skip pair that pings the chat
 * with a canned summary so the assistant can move to the next section.
 */

type SalesCallRow = {
  id: string;
  source_type:
    | "audio_upload"
    | "loom"
    | "fireflies"
    | "gong"
    | "other_url";
  source_url: string | null;
  filename: string | null;
  status: "pending" | "transcribing" | "ready" | "error";
  error: string | null;
  created_at: string;
};

const ACCEPT = ".mp3,.m4a,.webm,.ogg,.wav,audio/*";

export function SalesCallUploader({
  onFinish,
}: {
  onFinish: (canned: string) => void;
}) {
  const [calls, setCalls] = useState<SalesCallRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [submittingUrl, setSubmittingUrl] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    fetch("/api/onboarding/sales-calls/upload")
      .then((r) => r.json())
      .then((data) => setCalls(data.salesCalls ?? []))
      .catch(() => {});
  }, []);

  async function uploadAudio(files: FileList) {
    if (done) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/onboarding/sales-calls/upload", {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (data.salesCall) {
          setCalls((prev) => [data.salesCall, ...prev]);
        } else if (!res.ok) {
          throw new Error(data.error || "Upload failed");
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
    } finally {
      setUploading(false);
    }
  }

  async function submitUrl() {
    if (!url.trim() || submittingUrl || done) return;
    setError(null);
    setSubmittingUrl(true);
    try {
      const res = await fetch("/api/onboarding/sales-calls/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (data.salesCall) {
        setCalls((prev) => [data.salesCall, ...prev]);
        setUrl("");
      } else if (!res.ok) {
        throw new Error(data.error || "URL submission failed");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "URL submission failed";
      setError(message);
    } finally {
      setSubmittingUrl(false);
    }
  }

  function handleContinue() {
    if (done) return;
    setDone(true);
    const ready = calls.filter((c) => c.status === "ready").length;
    const pending = calls.filter(
      (c) => c.status === "pending" || c.status === "transcribing",
    ).length;
    const errored = calls.filter((c) => c.status === "error").length;
    if (calls.length === 0) {
      onFinish("No sales calls to upload right now  -  ready to continue.");
      return;
    }
    const parts: string[] = [];
    if (ready) parts.push(`${ready} ready`);
    if (pending) parts.push(`${pending} still transcribing`);
    if (errored) parts.push(`${errored} errored`);
    onFinish(
      `Uploaded ${calls.length} sales call${calls.length === 1 ? "" : "s"} (${parts.join(", ")})  -  done with sales calls.`,
    );
  }

  function handleSkip() {
    if (done) return;
    setDone(true);
    onFinish("Skipping sales-call ingestion for now.");
  }

  return (
    <div className="rg-fade-in rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0A1210] p-4">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(12,191,106,0.12)]">
          <Mic className="h-3.5 w-3.5 text-[#0CBF6A]" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Drop in your sales calls
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            Audio (mp3/m4a/webm) or Loom/Fireflies/Gong link
          </p>
        </div>
      </div>

      {/* Audio drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!done) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (done) return;
          if (e.dataTransfer.files?.length) uploadAudio(e.dataTransfer.files);
        }}
        className={`rounded-lg border border-dashed p-3 transition-colors ${
          dragOver
            ? "border-[#0CBF6A]/60 bg-[rgba(12,191,106,0.05)]"
            : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)]"
        }`}
      >
        <div className="flex items-center gap-3">
          <Upload className="h-4 w-4 shrink-0 text-muted-foreground/70" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-foreground">
              Audio recordings
            </p>
            <p className="text-[10px] text-muted-foreground/60">
              MP3, M4A, WEBM, OGG, WAV  -  up to 200 MB each
            </p>
          </div>
          <button
            type="button"
            disabled={done || uploading}
            onClick={() => inputRef.current?.click()}
            className="rounded-md border border-[rgba(255,255,255,0.1)] px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-[rgba(12,191,106,0.3)] hover:text-foreground disabled:opacity-40"
          >
            {uploading ? "Uploading…" : "Choose file"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => e.target.files && uploadAudio(e.target.files)}
          />
        </div>
      </div>

      {/* URL paste row */}
      <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-2.5">
        <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a Loom / Fireflies / Gong link"
          disabled={done || submittingUrl}
          className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/50 outline-none disabled:opacity-40"
          onKeyDown={(e) => {
            if (e.key === "Enter") submitUrl();
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={submitUrl}
          disabled={done || submittingUrl || !url.trim()}
        >
          {submittingUrl ? "Adding…" : "Add"}
        </Button>
      </div>

      {/* Uploaded list */}
      {calls.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-[rgba(255,255,255,0.04)] pt-3">
          {calls.map((call) => (
            <li
              key={call.id}
              className="flex items-center gap-2 text-[11px] text-muted-foreground"
            >
              <StatusIcon status={call.status} />
              <span className="min-w-0 flex-1 truncate">
                {call.filename || call.source_url || "(untitled)"}
              </span>
              <StatusBadge status={call.status} sourceType={call.source_type} />
              {call.error && (
                <span
                  title={call.error}
                  className="max-w-[160px] truncate text-[10px] text-destructive/80"
                >
                  {call.error}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-destructive">
          <X className="h-3 w-3" />
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleSkip}
          disabled={done}
          className="text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          Skip
        </button>
        <Button
          type="button"
          size="sm"
          onClick={handleContinue}
          disabled={done || uploading || submittingUrl}
        >
          {done
            ? "Saved"
            : calls.length > 0
              ? `Continue with ${calls.length} call${calls.length === 1 ? "" : "s"}`
              : "Nothing to upload"}
        </Button>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: SalesCallRow["status"] }) {
  if (status === "ready") {
    return <Check className="h-3 w-3 shrink-0 text-[#0CBF6A]" />;
  }
  if (status === "error") {
    return <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />;
  }
  return (
    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/70" />
  );
}

function StatusBadge({
  status,
  sourceType,
}: {
  status: SalesCallRow["status"];
  sourceType: SalesCallRow["source_type"];
}) {
  const tone =
    status === "ready"
      ? "bg-[rgba(12,191,106,0.1)] text-[#0CBF6A]"
      : status === "error"
        ? "bg-destructive/10 text-destructive"
        : "bg-[rgba(255,255,255,0.06)] text-muted-foreground";
  const label =
    status === "ready"
      ? sourceType === "audio_upload"
        ? "Transcribed"
        : "Ready"
      : status === "transcribing"
        ? "Transcribing"
        : status === "pending"
          ? "Pending"
          : "Error";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

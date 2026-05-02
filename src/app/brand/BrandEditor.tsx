"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Pencil, X, Save } from "lucide-react";

const MD_COMPONENTS = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-4 mt-6 font-serif text-3xl tracking-tight text-foreground first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-3 mt-8 font-serif text-xl tracking-tight text-foreground">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-2 mt-6 text-[13px] font-semibold uppercase tracking-[1.5px] text-primary">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-4 ml-5 list-disc space-y-1.5 text-sm text-muted-foreground marker:text-primary/60">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-4 ml-5 list-decimal space-y-1.5 text-sm text-muted-foreground marker:text-primary/60">{children}</ol>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-muted/40 px-1 py-0.5 font-mono text-[12px] text-primary">{children}</code>
  ),
};

export function BrandEditor({
  initialContent,
  initialVersion,
}: {
  initialContent: string;
  initialVersion: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(initialVersion);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/brand", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Save failed");
        return;
      }
      setVersion(body.profile.version);
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(initialContent);
    setEditing(false);
    setError(null);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[1.5px] text-muted-foreground">
          Version {version} · approved
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[min(var(--radius-md),12px)] border border-border px-3 text-sm hover:border-primary/40"
          >
            <Pencil className="size-3.5" />
            Edit brand
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[12px] text-amber-300">
            <span>
              You are editing the brand profile. Saving creates version {version + 1} (history kept).
            </span>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={28}
            className="w-full rounded-md border border-border bg-card/30 px-4 py-3 font-mono text-[12px] leading-relaxed text-foreground"
            placeholder="# Brand Profile&#10;&#10;## What we sell&#10;...&#10;&#10;## Voice & tone&#10;..."
          />
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving || draft.trim().length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-[min(var(--radius-md),12px)] bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
            >
              <Save className="size-3.5" />
              {saving ? "Saving..." : "Save as v" + (version + 1)}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="inline-flex h-8 items-center gap-1.5 rounded-[min(var(--radius-md),12px)] border border-border px-3 text-sm hover:border-primary/40"
            >
              <X className="size-3.5" />
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <article className="max-w-none">
          <ReactMarkdown components={MD_COMPONENTS}>{initialContent}</ReactMarkdown>
        </article>
      )}
    </div>
  );
}

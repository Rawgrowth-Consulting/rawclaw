"use client";

import { useState } from "react";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { jsonFetcher } from "@/lib/swr";
import { toast } from "sonner";
import { Key, Trash2, ExternalLink } from "lucide-react";

type KeyRow = {
  provider: string;
  label: string;
  description: string;
  docsUrl: string;
  placeholder: string;
  hasKey: boolean;
  preview: string | null;
  updatedAt: string | null;
};

export function ApiKeysCard() {
  const { data, mutate, isLoading } = useSWR<{ keys: KeyRow[] }>(
    "/api/connections/api-keys",
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  if (isLoading) {
    return (
      <Card className="border-border bg-card/50">
        <CardContent className="h-32 animate-pulse p-6" />
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card/50">
      <CardContent className="space-y-5 p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30">
            <Key className="size-5 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-foreground">
              Workspace API keys
            </h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Third-party tokens the agents call directly (no OAuth flow).
              Encrypted at rest with AES-256-GCM.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {(data?.keys ?? []).map((row) => (
            <ProviderRow key={row.provider} row={row} onChange={() => mutate()} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderRow({
  row,
  onChange,
}: {
  row: KeyRow;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (value.trim().length < 8) {
      toast.error("Key looks too short");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/connections/api-keys", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: row.provider, api_key: value.trim() }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
      toast.success(`${row.label} key saved`);
      setEditing(false);
      setValue("");
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${row.label} key?`)) return;
    try {
      const res = await fetch(
        `/api/connections/api-keys?provider=${row.provider}`,
        { method: "DELETE" },
      );
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "delete failed");
      toast.success(`${row.label} key removed`);
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="rounded-md border border-border bg-card/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-foreground">
              {row.label}
            </span>
            {row.hasKey ? (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-primary">
                Connected
              </span>
            ) : (
              <span className="rounded-full bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                Not set
              </span>
            )}
            <a
              href={row.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              docs
              <ExternalLink className="size-2.5" />
            </a>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {row.description}
          </p>
          {row.hasKey && row.preview && !editing && (
            <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
              {row.preview}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!editing && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setEditing(true)}
              className="h-7 text-[11px]"
            >
              {row.hasKey ? "Update" : "Add key"}
            </Button>
          )}
          {row.hasKey && !editing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={remove}
              className="h-7 px-2 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      {editing && (
        <div className="mt-3 flex items-center gap-2">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={row.placeholder}
            autoFocus
            className="h-8 flex-1 rounded-md border border-border bg-card/30 px-2 font-mono text-[12px] text-foreground"
          />
          <Button
            size="sm"
            onClick={save}
            disabled={saving}
            className="h-8 text-[11px]"
          >
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setValue("");
            }}
            className="h-8 text-[11px]"
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { jsonFetcher } from "@/lib/swr";
import { CreateClientSheet } from "@/components/admin/create-client-sheet";

type OrgMe = {
  org: {
    id: string;
    name: string;
    slug: string;
    mcp_token: string | null;
    created_at: string;
  };
  isAdmin: boolean;
  isImpersonating: boolean;
};

export function McpView() {
  const { data, isLoading, mutate } = useSWR<OrgMe>(
    "/api/org/me",
    jsonFetcher,
  );
  const [showToken, setShowToken] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [creating, setCreating] = useState(false);

  const org = data?.org;
  const isAdmin = data?.isAdmin ?? false;

  const rotate = async () => {
    if (!org) return;
    if (
      !confirm(
        `Rotate the MCP token for ${org.name}?\n\nThe old token stops working immediately — any Claude Desktop / Cursor config still using it will lose access until you paste in the new one.`,
      )
    )
      return;
    setRotating(true);
    try {
      const res = await fetch(
        `/api/admin/clients/${org.id}/rotate-token`,
        { method: "POST" },
      );
      if (!res.ok) {
        const { error } = (await res.json()) as { error?: string };
        throw new Error(error ?? "rotate failed");
      }
      toast.success("Token rotated");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRotating(false);
    }
  };

  if (isLoading || !org) {
    return (
      <div className="h-80 animate-pulse rounded-2xl border border-border bg-card/30" />
    );
  }

  const mcpUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/mcp`
      : "https://…/api/mcp";

  const configJson = `{
  "mcpServers": {
    "rawgrowth-${org.slug}": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer ${org.mcp_token ?? "<token>"}"
      }
    }
  }
}`;

  return (
    <>
      {isAdmin && (
        <div className="mb-4 flex items-center justify-end">
          <Button
            onClick={() => setCreating(true)}
            size="sm"
            className="btn-shine bg-primary text-white hover:bg-primary/90"
          >
            <Plus className="size-3.5" />
            New client
          </Button>
        </div>
      )}

      <Card className="border-border bg-card/50 backdrop-blur-sm">
        <CardContent className="flex flex-col gap-5 p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-xl font-normal tracking-tight text-foreground">
                  {org.name}
                </h2>
                <Badge
                  variant="secondary"
                  className="bg-white/5 font-mono text-[10px] text-muted-foreground"
                >
                  /{org.slug}
                </Badge>
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Paste the config below into any MCP-compatible client (Claude
                Desktop, Cursor, Claude Code, Claude Cowork) to give it
                read/write access to this workspace.
              </p>
            </div>
            <button
              type="button"
              onClick={rotate}
              disabled={rotating}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw
                className={rotating ? "size-3 animate-spin" : "size-3"}
              />
              Rotate token
            </button>
          </div>

          <div>
            <Label className="text-[11px] font-medium text-muted-foreground">
              MCP server URL
            </Label>
            <CopyableRow value={mcpUrl} />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-[11px] font-medium text-muted-foreground">
                Bearer token
              </Label>
              <button
                type="button"
                onClick={() => setShowToken((s) => !s)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {showToken ? (
                  <>
                    <EyeOff className="size-3" /> Hide
                  </>
                ) : (
                  <>
                    <Eye className="size-3" /> Show
                  </>
                )}
              </button>
            </div>
            <CopyableRow
              value={
                org.mcp_token
                  ? showToken
                    ? org.mcp_token
                    : `${org.mcp_token.slice(0, 12)}${"•".repeat(30)}`
                  : "(no token — click Rotate to mint one)"
              }
              copyValue={org.mcp_token ?? undefined}
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <KeyRound className="size-3" />
              Claude Desktop / Cursor config snippet
            </div>
            <CopyBlock value={configJson} />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Paste into{" "}
              <code className="font-mono text-foreground/80">
                ~/Library/Application Support/Claude/claude_desktop_config.json
              </code>{" "}
              (Claude Desktop) or the equivalent MCP config file for your
              client, then fully restart the app.
            </p>
          </div>
        </CardContent>
      </Card>

      {isAdmin && (
        <CreateClientSheet
          open={creating}
          onOpenChange={setCreating}
          onCreated={() => mutate()}
        />
      )}
    </>
  );
}

function CopyableRow({
  value,
  copyValue,
}: {
  value: string;
  copyValue?: string;
}) {
  const [copied, setCopied] = useState(false);
  const toCopy = copyValue ?? value;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toCopy);
      toast.success("Copied");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="mt-1 flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-2.5 py-1.5 font-mono text-[12px] text-foreground/85">
      <code className="flex-1 truncate">{value}</code>
      {toCopy && (
        <button
          type="button"
          onClick={copy}
          className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      )}
    </div>
  );
}

function CopyBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Config copied");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-background/40 p-3 font-mono text-[11.5px] leading-relaxed text-foreground/85">
        {value}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

"use client";

import { useState } from "react";
import useSWR from "swr";
import { ArrowUpRight, Check, Copy, Eye, EyeOff, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClaudeLogo } from "@/components/icons/claude-logo";
import { jsonFetcher } from "@/lib/swr";

type ClaudeStatus = {
  connected: boolean;
  installed_at?: string;
  token_preview?: string | null;
  token?: string;
};

const TOKEN_PREFIX = "sk-ant-oat01-";

export function ClaudeConnectionCard() {
  const { data, isLoading, mutate } = useSWR<ClaudeStatus>(
    "/api/connections/claude",
    jsonFetcher,
  );
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  const connected = data?.connected ?? false;

  const reveal = async () => {
    if (revealed) {
      setRevealed(null);
      return;
    }
    setRevealing(true);
    try {
      const res = await fetch("/api/connections/claude?reveal=1");
      const body = (await res.json()) as { token?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "reveal failed");
      if (!body.token) throw new Error("no token to reveal");
      setRevealed(body.token);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRevealing(false);
    }
  };

  const copyRevealed = async () => {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      toast.success("Token copied");
    } catch {
      /* ignore */
    }
  };

  const submit = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      toast.error("Paste your token first");
      return;
    }
    if (!trimmed.startsWith(TOKEN_PREFIX)) {
      toast.error(`Token must start with ${TOKEN_PREFIX}`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/connections/claude", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: trimmed }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Failed to save token");
      }
      setToken("");
      toast.success("Claude Max connected");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect your Claude Max from this workspace?")) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/connections/claude", { method: "DELETE" });
      if (!res.ok) {
        const { error } = (await res.json()) as { error?: string };
        throw new Error(error ?? "Disconnect failed");
      }
      toast.success("Disconnected");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDisconnecting(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-border bg-card/50">
        <CardContent className="h-48 animate-pulse p-6" />
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card/50">
      <CardContent className="space-y-5 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border"
              style={{ backgroundColor: "rgba(217, 119, 87, 0.1)" }}
            >
              <ClaudeLogo
                className="size-6"
                style={{ color: "#D97757" } as React.CSSProperties}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-foreground">
                  Claude Max
                </h3>
                {connected ? (
                  <Badge
                    variant="secondary"
                    className="bg-primary/15 text-[10px] text-primary"
                  >
                    Connected
                  </Badge>
                ) : (
                  <Badge
                    variant="secondary"
                    className="bg-amber-500/10 text-[10px] text-amber-400"
                  >
                    Not connected
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {connected
                  ? `Connected${data?.installed_at ? ` · ${new Date(data.installed_at).toLocaleDateString()}` : ""}`
                  : "Powers your VPS-side agents (24/7 Telegram replies + scheduled routines)"}
              </p>
            </div>
          </div>
          {connected && (
            <Button
              size="sm"
              variant="secondary"
              onClick={disconnect}
              disabled={disconnecting}
              className="bg-white/5 text-foreground hover:bg-white/10"
            >
              <X className="size-3.5" />
              Disconnect
            </Button>
          )}
        </div>

        {connected ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-[11px] font-medium text-muted-foreground">
                Stored token
              </Label>
              <button
                type="button"
                onClick={reveal}
                disabled={revealing}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                {revealed ? (
                  <>
                    <EyeOff className="size-3" /> Hide
                  </>
                ) : (
                  <>
                    <Eye className="size-3" /> {revealing ? "Loading…" : "Show"}
                  </>
                )}
              </button>
            </div>
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-[12px] text-foreground/85">
              <code className="flex-1 truncate">
                {revealed ?? data?.token_preview ?? `${TOKEN_PREFIX}…`}
              </code>
              {revealed && (
                <button
                  type="button"
                  onClick={copyRevealed}
                  className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label="Copy token"
                >
                  <Copy className="size-3.5" />
                </button>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Stored encrypted (AES-256-GCM). Synced to your VPS within
              60 seconds of any change.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <ol className="space-y-2 text-[12.5px] leading-relaxed text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">1.</span> Open
                Claude on your laptop (or sign in to your Claude account):
                <a
                  href="https://claude.ai/login"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Open claude.ai
                  <ArrowUpRight className="size-3" />
                </a>
              </li>
              <li>
                <span className="font-medium text-foreground">2.</span> In a
                terminal, run{" "}
                <code className="rounded bg-background/60 px-1.5 py-0.5 font-mono text-[11.5px] text-foreground">
                  claude setup-token
                </code>{" "}
                — sign in when the browser opens, then copy the{" "}
                <code className="rounded bg-background/60 px-1.5 py-0.5 font-mono text-[11.5px] text-foreground">
                  {TOKEN_PREFIX}…
                </code>{" "}
                token it prints.
              </li>
              <li>
                <span className="font-medium text-foreground">3.</span> Paste
                it below and hit Connect.
              </li>
            </ol>

            <div>
              <Label
                htmlFor="claude-token"
                className="text-[11px] font-medium text-muted-foreground"
              >
                Long-lived token
              </Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  id="claude-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={`${TOKEN_PREFIX}…`}
                  className="font-mono text-[12px]"
                  autoComplete="off"
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !submitting) submit();
                  }}
                />
                <Button
                  onClick={submit}
                  disabled={submitting || !token.trim()}
                  className="btn-shine bg-primary text-white hover:bg-primary/90"
                >
                  {submitting ? "Connecting…" : (
                    <>
                      <Check className="size-3.5" />
                      Connect
                    </>
                  )}
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Treat this like a password — it has full inference access
                against your Max subscription.
              </p>
            </div>
          </div>
        )}

        <div className="rounded-md border border-border bg-background/30 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">
              Native connectors (Gmail, Drive, Slack, Notion, GitHub, …)
            </span>{" "}
            live in your Claude account, not here. Connect them once and
            every agent picks them up.
          </p>
          <a
            href="https://claude.ai/settings/connectors"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline"
          >
            Open Claude connector settings
            <ArrowUpRight className="size-3" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

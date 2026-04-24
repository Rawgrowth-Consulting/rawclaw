"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import {
  ArrowUpRight,
  Check,
  ExternalLink,
  Pencil,
  X,
} from "lucide-react";
import { SiSlack } from "react-icons/si";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { jsonFetcher } from "@/lib/swr";

type SlackStatus = {
  configured: boolean;
  installed: boolean;
  client_id: string | null;
  team: { id: string; name: string } | null;
  bot_user_id: string | null;
  scope: string | null;
  installed_at: string | null;
};

export function SlackConnectionCard() {
  const { data, isLoading, mutate } = useSWR<SlackStatus>(
    "/api/connections/slack",
    jsonFetcher,
  );

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  // Install state
  const [starting, setStarting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Surface OAuth callback outcome (?slack=connected / ?slack=error&reason=…)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const slackParam = url.searchParams.get("slack");
    if (!slackParam) return;
    if (slackParam === "connected") {
      const team = url.searchParams.get("team");
      toast.success(`Slack connected${team ? ` · ${team}` : ""}`);
      void mutate();
    } else if (slackParam === "error") {
      const reason = url.searchParams.get("reason") ?? "unknown";
      toast.error(`Slack install failed: ${reason}`);
    }
    url.searchParams.delete("slack");
    url.searchParams.delete("team");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", url.toString());
  }, [mutate]);

  const saveConfig = async () => {
    if (!clientId.trim() || !clientSecret.trim() || !signingSecret.trim()) {
      toast.error("Fill all three fields");
      return;
    }
    setSavingConfig(true);
    try {
      const res = await fetch("/api/connections/slack/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
          signing_secret: signingSecret.trim(),
        }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
      toast.success("Slack App config saved");
      setWizardOpen(false);
      setClientSecret("");
      setSigningSecret("");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingConfig(false);
    }
  };

  const startInstall = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/connections/slack/oauth/start");
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? "failed to start install");
      }
      window.open(body.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const disconnect = async () => {
    if (
      !confirm(
        "Disconnect Slack from this workspace? This revokes the bot token and clears your app credentials.",
      )
    )
      return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/connections/slack", { method: "DELETE" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "disconnect failed");
      toast.success("Slack disconnected");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDisconnecting(false);
    }
  };

  if (isLoading || !data) {
    return (
      <Card className="border-border bg-card/50">
        <CardContent className="h-40 animate-pulse p-6" />
      </Card>
    );
  }

  const redirectUri =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/connections/slack/oauth/callback`
      : "";
  const eventsUri =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/webhooks/slack`
      : "";

  return (
    <Card className="border-border bg-card/50">
      <CardContent className="space-y-5 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border"
              style={{ backgroundColor: "rgba(74, 21, 75, 0.12)" }}
            >
              <SiSlack className="size-5" style={{ color: "#4A154B" }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-foreground">
                  Slack
                </h3>
                {data.installed ? (
                  <Badge
                    variant="secondary"
                    className="bg-primary/15 text-[10px] text-primary"
                  >
                    Connected
                  </Badge>
                ) : data.configured ? (
                  <Badge
                    variant="secondary"
                    className="bg-blue-500/10 text-[10px] text-blue-400"
                  >
                    App configured · not installed
                  </Badge>
                ) : (
                  <Badge
                    variant="secondary"
                    className="bg-amber-500/10 text-[10px] text-amber-400"
                  >
                    Setup required
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {data.installed
                  ? `${data.team?.name ?? "workspace"} · installed ${data.installed_at ? new Date(data.installed_at).toLocaleDateString() : ""}`
                  : "Bind agents to channels and trigger on new messages, files, or mentions."}
              </p>
            </div>
          </div>
          {data.installed && (
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

        {data.installed ? (
          // ─── Connected state ──────────────────────────────────────
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-background/40 p-3 text-[11.5px]">
              <div>
                <div className="text-[10px] uppercase tracking-[1px] text-muted-foreground">
                  Workspace
                </div>
                <div className="mt-0.5 font-mono text-foreground">
                  {data.team?.name}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[1px] text-muted-foreground">
                  Bot user
                </div>
                <div className="mt-0.5 font-mono text-foreground">
                  {data.bot_user_id}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Pencil className="size-3" />
              Edit app credentials
            </button>
          </div>
        ) : data.configured && !wizardOpen ? (
          // ─── Configured, ready to install ─────────────────────────
          <div className="space-y-3">
            <p className="text-[12.5px] text-muted-foreground">
              Slack App creds saved. Now install the bot into your workspace —
              Slack will ask you to pick a workspace and approve the scopes.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={startInstall}
                disabled={starting}
                className="btn-shine bg-primary text-white hover:bg-primary/90"
              >
                <SiSlack className="size-3.5" />
                {starting ? "Starting…" : "Install to your Slack workspace"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setWizardOpen(true)}
                className="bg-white/5 text-foreground hover:bg-white/10"
              >
                <Pencil className="size-3.5" />
                Edit creds
              </Button>
            </div>
          </div>
        ) : (
          // ─── Setup wizard (not configured yet) ────────────────────
          <div className="space-y-4">
            <details className="rounded-md border border-border bg-background/30 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
              <summary className="cursor-pointer text-[12px] font-medium text-foreground">
                How to create your Slack App (~5 min, one-time)
              </summary>
              <ol className="mt-3 space-y-2 pl-4">
                <li>
                  Go to{" "}
                  <a
                    href="https://api.slack.com/apps"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    api.slack.com/apps <ArrowUpRight className="size-3" />
                  </a>{" "}
                  → <strong>Create New App</strong> → <strong>From scratch</strong>.
                </li>
                <li>
                  Name it <code>Rawgrowth</code>, pick any workspace to own the app (this doesn&apos;t limit installs).
                </li>
                <li>
                  In <strong>OAuth &amp; Permissions</strong>:
                  <ul className="mt-1 list-disc pl-5">
                    <li>
                      Redirect URL — paste this:
                      <code className="ml-1 block overflow-x-auto rounded bg-background/60 px-1.5 py-0.5 font-mono text-[10.5px]">
                        {redirectUri}
                      </code>
                    </li>
                    <li>
                      Bot Token Scopes — add:{" "}
                      <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10.5px]">
                        channels:read, channels:history, groups:read, groups:history, chat:write, files:read, users:read, app_mentions:read
                      </code>
                    </li>
                  </ul>
                </li>
                <li>
                  In <strong>Event Subscriptions</strong>:
                  <ul className="mt-1 list-disc pl-5">
                    <li>Enable Events → ON</li>
                    <li>
                      Request URL:
                      <code className="ml-1 block overflow-x-auto rounded bg-background/60 px-1.5 py-0.5 font-mono text-[10.5px]">
                        {eventsUri}
                      </code>
                    </li>
                    <li>
                      Subscribe to bot events:{" "}
                      <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10.5px]">
                        message.channels, message.groups, app_mention, file_shared
                      </code>
                    </li>
                  </ul>
                </li>
                <li>
                  In <strong>Basic Information</strong> (or <strong>App Credentials</strong>): copy <strong>Client ID</strong>, <strong>Client Secret</strong>, and <strong>Signing Secret</strong>. Paste them below.
                </li>
              </ol>
            </details>

            <div className="space-y-3">
              <div>
                <Label className="text-[11px] font-medium text-muted-foreground">
                  Client ID
                </Label>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="1234567890.1234567890123"
                  className="mt-1 font-mono text-[12px]"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div>
                <Label className="text-[11px] font-medium text-muted-foreground">
                  Client Secret
                </Label>
                <Input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="from Basic Information → App Credentials"
                  className="mt-1 font-mono text-[12px]"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div>
                <Label className="text-[11px] font-medium text-muted-foreground">
                  Signing Secret
                </Label>
                <Input
                  type="password"
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                  placeholder="used to verify Slack Events webhook signatures"
                  className="mt-1 font-mono text-[12px]"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={saveConfig}
                  disabled={savingConfig}
                  className="btn-shine bg-primary text-white hover:bg-primary/90"
                >
                  {savingConfig ? "Saving…" : (
                    <>
                      <Check className="size-3.5" />
                      Save &amp; continue
                    </>
                  )}
                </Button>
                {data.configured && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setWizardOpen(false);
                      setClientSecret("");
                      setSigningSecret("");
                    }}
                    className="bg-white/5 text-foreground hover:bg-white/10"
                  >
                    Cancel
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                All three secrets are encrypted at rest (AES-256-GCM).
              </p>
            </div>
          </div>
        )}

        {!data.installed && (
          <div className="rounded-md border border-border bg-background/30 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Why set up my own Slack App?</span>{" "}
              Slack only allows one Events URL per app. Per-client Apps keep
              each workspace&apos;s events isolated to its own VPS, no central
              gateway needed.
            </p>
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline"
            >
              Open api.slack.com/apps
              <ExternalLink className="size-3" />
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

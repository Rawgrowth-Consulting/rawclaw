"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  KeyRound,
  LogOut,
  Plug,
  ShieldCheck,
  Webhook,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  getIntegration,
  methodLabel,
  type AuthMethod,
  type IntegrationEntry,
} from "@/lib/integrations-catalog";
import { useIntegrationsStore, type Connection } from "@/lib/integrations-store";

type Props = {
  integrationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const methodIcon: Record<AuthMethod, typeof KeyRound> = {
  api_key: KeyRound,
  oauth: ShieldCheck,
  webhook: Webhook,
};

export function IntegrationConnectionSheet({
  integrationId,
  open,
  onOpenChange,
}: Props) {
  const integration = integrationId ? getIntegration(integrationId) : null;
  const getConnection = useIntegrationsStore((s) => s.getConnection);
  const connect = useIntegrationsStore((s) => s.connect);
  const disconnect = useIntegrationsStore((s) => s.disconnect);
  const connection = integrationId ? getConnection(integrationId) : undefined;

  const [activeMethod, setActiveMethod] = useState<AuthMethod | null>(null);
  useEffect(() => {
    if (!integration) {
      setActiveMethod(null);
      return;
    }
    // When opening: prefer the method they're already connected with,
    // otherwise the first method the provider supports.
    setActiveMethod(connection?.method ?? integration.methods[0] ?? null);
  }, [integration, connection?.method, open]);

  if (!integration) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col border-l border-border bg-background p-0 text-foreground sm:max-w-150"
        />
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col border-l border-border bg-background p-0 text-foreground sm:max-w-150"
      >
        <SheetHeader className="border-b border-border px-6 py-5">
          <div className="flex items-center gap-3">
            <div
              className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border"
              style={{ backgroundColor: `${integration.brand}1f` }}
            >
              <integration.Icon
                className="size-6"
                style={{
                  color:
                    integration.brand === "#FFFFFF" ? "#fff" : integration.brand,
                }}
              />
            </div>
            <div className="min-w-0">
              <SheetTitle className="font-serif text-2xl font-normal tracking-tight text-foreground">
                {integration.name}
              </SheetTitle>
              <SheetDescription className="text-[13px] text-muted-foreground">
                {integration.description}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {connection && (
            <CurrentConnectionCard
              connection={connection}
              integration={integration}
            />
          )}

          {/* Method tabs — only show if multiple methods supported OR not yet connected */}
          {integration.methods.length > 1 && (
            <div className="mb-4 flex items-center gap-1 rounded-lg border border-border bg-card/30 p-1">
              {integration.methods.map((m) => {
                const Icon = methodIcon[m];
                const active = activeMethod === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setActiveMethod(m)}
                    className={cn(
                      "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                      active
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                    {methodLabel(m)}
                  </button>
                );
              })}
            </div>
          )}

          {activeMethod === "api_key" && integration.apiKey && (
            <ApiKeyForm
              integration={integration}
              existing={
                connection?.method === "api_key" ? connection : undefined
              }
              onConnect={(key) => {
                connect({
                  integrationId: integration.id,
                  method: "api_key",
                  apiKey: key,
                });
                onOpenChange(false);
              }}
            />
          )}

          {activeMethod === "oauth" && integration.oauth && (
            <OAuthForm
              integration={integration}
              existing={connection?.method === "oauth" ? connection : undefined}
              onConnect={() => {
                if (!integration.oauth) return;
                connect({
                  integrationId: integration.id,
                  method: "oauth",
                  account: integration.oauth.exampleAccount,
                  scopes: integration.oauth.scopes,
                });
                onOpenChange(false);
              }}
            />
          )}

          {activeMethod === "webhook" && integration.webhook && (
            <WebhookForm
              integration={integration}
              existing={
                connection?.method === "webhook" ? connection : undefined
              }
              onConnect={() => {
                connect({
                  integrationId: integration.id,
                  method: "webhook",
                });
              }}
            />
          )}
        </div>

        <SheetFooter className="border-t border-border bg-background px-6 py-4">
          <div className="flex w-full items-center justify-between gap-3">
            {connection ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  disconnect(integration.id);
                  onOpenChange(false);
                }}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="size-3.5" /> Disconnect
              </Button>
            ) : (
              <div />
            )}
            <SheetClose
              render={
                <Button variant="ghost" size="sm">
                  Close
                </Button>
              }
            />
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ────────────────────────── Current connection card ──────────────────────────

function CurrentConnectionCard({
  connection,
  integration,
}: {
  connection: Connection;
  integration: IntegrationEntry;
}) {
  const Icon = methodIcon[connection.method];
  return (
    <div
      className="mb-6 rounded-xl border border-[rgba(10,148,82,.25)] p-4"
      style={{
        background:
          "linear-gradient(160deg, rgba(12,191,106,.08) 0%, rgba(12,191,106,.02) 60%, rgba(255,255,255,.01) 100%)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Icon className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
              Connected via {methodLabel(connection.method)}
              <Check className="size-3.5 text-primary" />
            </div>
            <div className="text-[11px] text-muted-foreground">
              Since {new Date(connection.connectedAt).toLocaleDateString()}
            </div>
          </div>
        </div>
        <Badge
          variant="secondary"
          className="gap-1 bg-primary/15 text-[10px] text-primary"
        >
          <span className="size-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(12,191,106,.6)]" />
          Live
        </Badge>
      </div>
      {connection.method === "api_key" && connection.apiKeyMasked && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-background/30 px-2.5 py-1.5 font-mono text-[11.5px] text-foreground/80">
          {integration.apiKey?.placeholder.slice(0, 4)}
          {connection.apiKeyMasked}
        </div>
      )}
      {connection.method === "oauth" && (
        <div className="mt-3 space-y-1.5 text-[11.5px] text-muted-foreground">
          <div>
            Account:{" "}
            <span className="text-foreground">{connection.oauthAccount}</span>
          </div>
          {connection.oauthScopes && (
            <div className="flex flex-wrap items-center gap-1">
              <span>Scopes:</span>
              {connection.oauthScopes.map((s) => (
                <code
                  key={s}
                  className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10.5px] text-foreground/80"
                >
                  {s}
                </code>
              ))}
            </div>
          )}
        </div>
      )}
      {connection.method === "webhook" && connection.webhookUrl && (
        <div className="mt-3 flex items-center gap-1.5 rounded-md border border-border bg-background/30 px-2.5 py-1.5 font-mono text-[11px] text-foreground/80">
          <code className="truncate">{connection.webhookUrl}</code>
        </div>
      )}
    </div>
  );
}

// ────────────────────────── API Key form ──────────────────────────

function ApiKeyForm({
  integration,
  existing,
  onConnect,
}: {
  integration: IntegrationEntry;
  existing?: Connection;
  onConnect: (apiKey: string) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!apiKey.trim()) {
      setError("Paste an API key to continue.");
      return;
    }
    onConnect(apiKey.trim());
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label className="text-[12px] font-medium text-foreground">
          {existing ? "Replace API key" : "API key"}
        </Label>
        <div className="mt-1.5 flex items-stretch gap-2">
          <Input
            type={show ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={integration.apiKey?.placeholder}
            className="flex-1 bg-input/40 font-mono text-[12.5px]"
            autoComplete="off"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShow((s) => !s)}
            className="shrink-0"
          >
            {show ? "Hide" : "Show"}
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-border bg-card/40 px-3 py-2.5">
        <KeyRound className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="text-[11.5px] leading-relaxed text-muted-foreground">
          <div>Where to find it:</div>
          <div className="mt-0.5 text-foreground/90">
            {integration.apiKey?.where}
          </div>
          {integration.apiKey?.docsUrl && (
            <a
              href={integration.apiKey.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open docs <ArrowUpRight className="size-3" />
            </a>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {error}
        </div>
      )}

      <Button
        onClick={submit}
        size="sm"
        className="btn-shine w-full bg-primary text-white hover:bg-primary/90"
      >
        <Plug className="size-4" />
        {existing ? "Update key" : `Connect ${integration.name}`}
      </Button>
      <p className="text-center text-[10.5px] text-muted-foreground">
        Stored locally in dev. In production, keys are encrypted at rest.
      </p>
    </div>
  );
}

// ────────────────────────── OAuth form ──────────────────────────

function OAuthForm({
  integration,
  existing,
  onConnect,
}: {
  integration: IntegrationEntry;
  existing?: Connection;
  onConnect: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const live = integration.oauth?.authorizeUrl;

  const handleConnect = () => {
    setConnecting(true);
    if (live) {
      // Real OAuth: redirect to our authorize endpoint; the callback will
      // write the connection row server-side. When user lands back on
      // /integrations, the sheet rehydrates from the store.
      window.location.href = live;
      return;
    }
    // Fallback: simulated flow for integrations not yet wired to real OAuth
    setTimeout(() => {
      setConnecting(false);
      onConnect();
    }, 900);
  };

  if (existing) {
    return (
      <div className="text-[12.5px] text-muted-foreground">
        Already connected via OAuth. Disconnect and reconnect to change the
        account or re-authorize scopes.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <div className="text-[12.5px] font-semibold text-foreground">
            Scopes requested
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {integration.oauth?.scopes.map((s) => (
            <code
              key={s}
              className="rounded border border-border bg-background/30 px-1.5 py-0.5 font-mono text-[10.5px] text-foreground/80"
            >
              {s}
            </code>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          You&apos;ll be redirected to {integration.name} to sign in. Rawgrowth
          will only receive the scopes listed above. You can revoke access at
          any time from their settings.
        </p>
      </div>

      <Button
        onClick={handleConnect}
        size="sm"
        disabled={connecting}
        className="btn-shine w-full bg-primary text-white hover:bg-primary/90"
      >
        <ShieldCheck className="size-4" />
        {connecting ? `Redirecting to ${integration.name}…` : `Connect with ${integration.name}`}
      </Button>
      <p className="text-center text-[10.5px] text-muted-foreground">
        {live
          ? "Live OAuth flow — you'll be redirected to Google."
          : "OAuth flow is mocked in dev. Production wires to the real provider."}
      </p>
    </div>
  );
}

// ────────────────────────── Webhook form ──────────────────────────

function WebhookForm({
  integration,
  existing,
  onConnect,
}: {
  integration: IntegrationEntry;
  existing?: Connection;
  onConnect: () => void;
}) {
  // Generate preview values only if not connected yet so the preview matches
  // what will actually be saved on Connect.
  const preview = useMemo(() => {
    if (existing?.webhookUrl && existing.webhookSecret) {
      return { url: existing.webhookUrl, secret: existing.webhookSecret };
    }
    return {
      url: `https://aios.rawgrowth.ai/api/webhooks/${integration.id}/${Math.random()
        .toString(36)
        .slice(2, 14)}`,
      secret: `whsec_${Math.random().toString(36).slice(2, 30)}`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label className="text-[12px] font-medium text-foreground">
          Webhook URL
        </Label>
        <CopyableField value={preview.url} className="mt-1.5 font-mono" />
      </div>

      <div>
        <Label className="text-[12px] font-medium text-foreground">
          Signing secret
        </Label>
        <CopyableField value={preview.secret} className="mt-1.5 font-mono" />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Use this to verify incoming request signatures on our end.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-border bg-card/40 px-3 py-2.5">
        <Webhook className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="text-[11.5px] leading-relaxed text-muted-foreground">
          <div className="font-medium text-foreground/90">
            How to wire it up
          </div>
          <div className="mt-0.5">{integration.webhook?.instructions}</div>
          {integration.webhook?.docsUrl && (
            <a
              href={integration.webhook.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open docs <ArrowUpRight className="size-3" />
            </a>
          )}
        </div>
      </div>

      {!existing && (
        <Button
          onClick={onConnect}
          size="sm"
          className="btn-shine w-full bg-primary text-white hover:bg-primary/90"
        >
          <Plug className="size-4" />
          Save webhook connection
        </Button>
      )}
    </div>
  );
}

// ────────────────────────── Copyable field ──────────────────────────

function CopyableField({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no-op */
    }
  };
  return (
    <div className="flex items-stretch gap-2">
      <div
        className={cn(
          "flex flex-1 items-center rounded-md border border-border bg-input/40 px-2.5 py-1.5 text-[11.5px] text-foreground/80",
          className,
        )}
      >
        <code className="truncate">{value}</code>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={copy}
        className="shrink-0 gap-1"
      >
        {copied ? (
          <>
            <Check className="size-3.5" /> Copied
          </>
        ) : (
          <>
            <Copy className="size-3.5" /> Copy
          </>
        )}
      </Button>
    </div>
  );
}

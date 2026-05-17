"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR, { mutate } from "swr";
import { Bell, X } from "lucide-react";
import { jsonFetcher } from "@/lib/swr";
import { humanizeJargon } from "@/lib/agent/jargon";
import type { NotificationGroup } from "@/lib/notifications/grouping";

type Payload = { groups: NotificationGroup[]; unread: number };

const API = "/api/notifications/grouped";
const DISMISS_API = "/api/notifications/agents";

function fmtTs(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString();
}

/**
 * F-2 bell. Same source as <NotificationBell /> but rendered as
 * sections keyed by kind. Badge sums unread across groups so the
 * operator sees one number for "stuff that needs my eyes".
 */
export function BellGrouped() {
  const [open, setOpen] = useState(false);
  const { data } = useSWR<Payload>(API, jsonFetcher, {
    refreshInterval: 5_000,
    refreshWhenHidden: false,
  });
  const groups = data?.groups ?? [];
  const unread = data?.unread ?? 0;

  async function dismissAll() {
    await fetch(DISMISS_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    await mutate(API);
  }

  async function dismissOne(id: string) {
    await fetch(DISMISS_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await mutate(API);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications (${unread} unread)`}
        className="relative rounded p-2 text-muted-foreground hover:bg-muted/40"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 rounded-full bg-red-500 px-1.5 py-0 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30"
            aria-hidden
          />
          <div className="absolute right-0 z-40 mt-2 w-96 rounded border border-border bg-background shadow-lg">
            <header className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-semibold">Notifications</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={dismissAll}
                  disabled={unread === 0}
                  className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
                >
                  Mark all read
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted/40"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className="max-h-[60vh] overflow-y-auto">
              {groups.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No notifications.
                </div>
              ) : (
                groups.map((g) => (
                  <section key={g.kind} className="border-b border-border last:border-b-0">
                    <div className="flex items-center justify-between bg-muted/30 px-3 py-1 text-xs font-semibold uppercase text-muted-foreground">
                      <span>{g.label}</span>
                      <span>{g.count}</span>
                    </div>
                    <ul>
                      {g.latest.map((n) => (
                        <li
                          key={n.id}
                          className="group flex items-start justify-between gap-2 border-t border-border px-3 py-2 text-sm hover:bg-muted/20 first:border-t-0"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-xs font-semibold">
                                {n.agent_name}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {fmtTs(n.created_at)}
                              </span>
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {humanizeJargon(n.content)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => dismissOne(n.id)}
                            className="opacity-0 group-hover:opacity-100 rounded p-1 text-muted-foreground hover:bg-muted/40"
                            aria-label="Dismiss"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>

            <footer className="border-t border-border px-3 py-2 text-center">
              <Link
                href="/notifications"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => setOpen(false)}
              >
                See all
              </Link>
            </footer>
          </div>
        </>
      ) : null}
    </div>
  );
}

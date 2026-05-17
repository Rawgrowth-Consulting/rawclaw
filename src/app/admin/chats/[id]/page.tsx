import { redirect } from "next/navigation";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { isChatId, loadChatTraceForExport } from "@/lib/admin/chat-export";

export const dynamic = "force-dynamic";

/**
 * F-? P1: admin per-chat trace export page. Lists basic metadata
 * for the agent's transcript + an Export-as-JSON button that
 * downloads the full trace via /api/admin/chats/[id]/export.
 *
 * Useful for: customer support receipts, debugging a single agent
 * loop offline, audit retention before pruning.
 */
export default async function AdminChatExportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin || !ctx.activeOrgId) redirect("/auth/signin");
  if (!isChatId(id)) {
    return (
      <PageShell title="Chat trace" description="Invalid chat id.">
        <p className="text-sm text-red-400">
          Chat id <code>{id}</code> must be a uuid.
        </p>
      </PageShell>
    );
  }
  const { trace } = await loadChatTraceForExport(ctx.activeOrgId, id);

  return (
    <PageShell
      title={`Chat trace · ${id.slice(0, 8)}`}
      description="Export the full per-turn transcript (reasoning, tool calls, tool results) as JSON. Admin only."
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">Chat id</dt>
          <dd className="font-mono">{id}</dd>
          <dt className="text-muted-foreground">Messages</dt>
          <dd>{trace.messageCount.toLocaleString("en-US")}</dd>
        </dl>
        {trace.messageCount === 0 ? (
          <p className="rounded border border-border p-4 text-sm text-muted-foreground">
            No messages recorded for this agent. Nothing to export.
          </p>
        ) : (
          <Link
            href={`/api/admin/chats/${id}/export`}
            className="inline-block rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
            download={`chat-${id}.json`}
          >
            Export trace (JSON)
          </Link>
        )}
      </div>
    </PageShell>
  );
}

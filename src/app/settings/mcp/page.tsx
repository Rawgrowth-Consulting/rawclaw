import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/admin";
import { PageShell } from "@/components/page-shell";
import { McpView } from "@/components/settings/mcp-view";

export const metadata = {
  title: "MCP — Rawgrowth",
};

export default async function McpSettingsPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/auth/signin");

  return (
    <PageShell
      title="MCP"
      description="Connect Claude Desktop, Cursor, or any MCP-compatible client to this workspace."
    >
      <McpView />
    </PageShell>
  );
}

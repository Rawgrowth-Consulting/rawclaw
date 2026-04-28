/**
 * Deploy-mode flag. Read once; used to branch behaviour between the
 * hosted SaaS (v1) and self-hosted VPS (v2) SKUs.
 *
 *   hosted       — Vercel + Supabase Cloud, executor runs with Anthropic API
 *   self_hosted  — Per-client VPS, no API, agents driven by Claude Code via MCP
 */

export type DeployMode = "hosted" | "self_hosted";

export const DEPLOY_MODE: DeployMode =
  (process.env.DEPLOY_MODE as DeployMode | undefined) === "self_hosted"
    ? "self_hosted"
    : "hosted";

export const isSelfHosted = DEPLOY_MODE === "self_hosted";
export const isHosted = DEPLOY_MODE === "hosted";

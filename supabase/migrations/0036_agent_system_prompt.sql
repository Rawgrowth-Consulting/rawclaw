-- Per-agent system prompt. Filled in by the role-template auto-train
-- post-create hook (src/lib/agents/role-templates.ts) when an agent is
-- hired with a known role label. Falls back to null for legacy agents
-- and freeform roles, in which case the runtime persona stays as
-- "<role> + description" exactly like before.
--
-- Idempotent. Safe to re-run.

alter table rgaios_agents
  add column if not exists system_prompt text;

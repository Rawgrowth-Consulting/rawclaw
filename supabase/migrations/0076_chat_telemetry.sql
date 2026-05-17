-- 0076: Chat preamble telemetry (rgaios_chat_telemetry).
--
-- DEEP WIN 4 phase 3 follow-up. The preamble selector
-- (selectChatBlocks + describeSelection in src/lib/agent/context.ts)
-- already emits an opt-in telemetry callback per turn via the
-- `telemetry` option on composeChatPreamble. Today both call-sites
-- (chat route + telegram webhook) only console.info that payload, so
-- the data dies with the process.
--
-- This table is the persistent sink. Every row captures one
-- composeChatPreamble decision: which blocks were selected, which
-- were skipped, by budget vs by mode, the estimated token cost vs
-- the budget cap, and the role flags that drove the policy. The
-- admin /telemetry page reads this to answer "why was block X
-- skipped for agent Y last night" without re-running the agent.
--
-- Service-role writers (the chat + telegram routes) bypass RLS so
-- they can land rows for any org. anon-key admin reads go through
-- the standard org-scoped policy: `organization_id =
-- rgaios_current_org_id()`. Same pattern as 0072_agent_messages and
-- every other rgaios_* table touched after 0065.
--
-- Idempotent: every statement uses IF NOT EXISTS / DROP IF EXISTS.

create table if not exists rgaios_chat_telemetry (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references rgaios_organizations(id) on delete cascade,
  agent_id               uuid references rgaios_agents(id) on delete set null,
  mode                   text not null,                              -- chat|telegram|owner_chat|... (matches ChatPreambleMode)
  selected_block_ids     text[] not null default '{}',
  skipped_block_ids      text[] not null default '{}',
  estimated_tokens       integer not null,
  budget_tokens          integer not null,
  skipped_by_budget      boolean not null default false,
  role_flags             jsonb,                                      -- isOwner / isCeo / isDeptHead / isSpecialist snapshot
  message_count          integer,                                    -- chat history depth at decision time (chat route only)
  created_at             timestamptz not null default now()
);

-- Admin queries filter by (organization_id, agent_id, created_at desc).
create index if not exists rgaios_chat_telemetry_agent_idx
  on rgaios_chat_telemetry (organization_id, agent_id, created_at desc);

-- "Why was this block skipped" queries scan by selected/skipped set membership.
-- GIN on the skipped array gives O(log n) for ANY('block_id') filters.
create index if not exists rgaios_chat_telemetry_skipped_gin
  on rgaios_chat_telemetry using gin (skipped_block_ids);

-- ─── RLS ──────────────────────────────────────────────────────────
alter table rgaios_chat_telemetry enable row level security;
alter table rgaios_chat_telemetry force row level security;
drop policy if exists rgaios_v3_chat_telemetry_org_isolation
  on rgaios_chat_telemetry;
create policy rgaios_v3_chat_telemetry_org_isolation
  on rgaios_chat_telemetry
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());

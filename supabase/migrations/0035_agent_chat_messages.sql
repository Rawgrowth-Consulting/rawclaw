-- In-app agent chat (P0 #1, plan wiggly-hugging-sutherland §1).
--
-- Persists user <> agent conversations from the new Chat tab in
-- AgentPanelClient. Mirrors the role / content shape of OpenAI's
-- chat-completion turns so we can pass rows directly into the
-- chatReply() history buffer used by Telegram.
--
-- Scope keys: organization_id (RLS) + agent_id (per-agent thread).
-- user_id remembers which operator typed the message; nullable so a
-- system-emitted assistant turn doesn't fail the FK when the user row
-- is later deleted.

create table if not exists rgaios_agent_chat_messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  agent_id        uuid not null references rgaios_agents(id) on delete cascade,
  user_id         uuid references rgaios_users(id) on delete set null,
  role            text not null check (role in ('user','assistant','system')),
  content         text not null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists rgaios_agent_chat_messages_agent_idx
  on rgaios_agent_chat_messages (agent_id, created_at desc);

create index if not exists rgaios_agent_chat_messages_org_idx
  on rgaios_agent_chat_messages (organization_id, created_at desc);

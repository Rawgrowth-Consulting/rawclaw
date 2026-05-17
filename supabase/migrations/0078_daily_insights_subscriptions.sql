-- 0078: daily-insights Telegram digest subscriptions
-- (rgaios_daily_insights_subscriptions).
--
-- F-8. One row per (org, chat_id) pair that wants a once-a-day
-- digest of the prior 24h chat telemetry shipped at 09:00 local
-- time (per the org timezone). Idle until a row is inserted; no
-- broadcast to orgs without an explicit subscription.
--
-- Token reuse: the digest sender pulls the bot token from the
-- existing rgaios_agent_telegram_bots row referenced by
-- agent_telegram_bot_id, so we never store a second copy of the
-- secret. The agent owner already maintains that token.
--
-- Dry-run flag covers the first-3-sends gate: the worker stops
-- after the third send while dry_run = true so ops can eyeball
-- the digest text before flipping it off.
--
-- Idempotent: IF NOT EXISTS / DROP IF EXISTS throughout.

create table if not exists rgaios_daily_insights_subscriptions (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references rgaios_organizations(id) on delete cascade,
  chat_id                     bigint not null,                            -- Telegram chat id (user or group)
  agent_telegram_bot_id       uuid not null references rgaios_agent_telegram_bots(id) on delete cascade,
  timezone                    text not null default 'UTC',                -- IANA tz id; worker uses to gate "is it 09:00 local"
  send_hour_local             smallint not null default 9 check (send_hour_local between 0 and 23),
  enabled                     boolean not null default true,
  dry_run                     boolean not null default true,              -- worker stops after 3 sends while dry_run
  dry_run_sends_remaining     smallint not null default 3 check (dry_run_sends_remaining >= 0),
  last_sent_at                timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (organization_id, chat_id, agent_telegram_bot_id)
);

create index if not exists rgaios_daily_insights_subs_org_idx
  on rgaios_daily_insights_subscriptions (organization_id);

create index if not exists rgaios_daily_insights_subs_due_idx
  on rgaios_daily_insights_subscriptions (enabled, last_sent_at)
  where enabled = true;

-- ─── updated_at touch ─────────────────────────────────────────────
create or replace function rgaios_daily_insights_subs_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rgaios_daily_insights_subs_touch
  on rgaios_daily_insights_subscriptions;
create trigger rgaios_daily_insights_subs_touch
  before update on rgaios_daily_insights_subscriptions
  for each row execute function rgaios_daily_insights_subs_touch();

-- ─── RLS ──────────────────────────────────────────────────────────
alter table rgaios_daily_insights_subscriptions enable row level security;
alter table rgaios_daily_insights_subscriptions force row level security;
drop policy if exists rgaios_v3_daily_insights_subs_isolation
  on rgaios_daily_insights_subscriptions;
create policy rgaios_v3_daily_insights_subs_isolation
  on rgaios_daily_insights_subscriptions
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());

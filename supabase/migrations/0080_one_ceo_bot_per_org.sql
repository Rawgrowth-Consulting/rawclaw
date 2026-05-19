-- One Telegram bot per organization, wired to the CEO agent only.
--
-- Pedro 2026-05-19 mandate: there is NOT one Telegram bot per agent.
-- One bot per VPS, attached to the CEO agent. CEO receives every DM
-- and orchestrates via agent_invoke (delegates to Marta / Kasia /
-- Ania / etc as needed). Per-agent bots are an anti-pattern that
-- splits the customer-facing surface and lets sub-agents skip the
-- orchestration step.
--
-- 0033 already enforced `unique(agent_id)` (one bot per agent) and
-- `unique(organization_id, bot_id)` (no dup Telegram bot id per org).
-- Neither prevents N agents in the same org each owning a bot. This
-- migration adds the missing constraint + a CHECK that the linked
-- agent is the CEO department head.

-- ─── 1. At most one bot row per organization ──────────────────────
create unique index if not exists rgaios_agent_telegram_bots_one_per_org
  on rgaios_agent_telegram_bots (organization_id);


-- ─── 2. Trigger: linked agent must be is_department_head + ceo ────
-- A CHECK constraint can't read another table, so we use a trigger.
-- Fires on INSERT and on UPDATE of agent_id.
create or replace function rgaios_assert_bot_agent_is_ceo()
returns trigger
language plpgsql
as $fn$
declare
  v_is_head boolean;
  v_dept text;
begin
  select is_department_head, department
    into v_is_head, v_dept
    from rgaios_agents
    where id = new.agent_id;

  if v_is_head is null then
    raise exception 'agent % not found', new.agent_id;
  end if;
  if v_is_head is not true or v_dept is distinct from 'ceo' then
    raise exception
      'Telegram bot can only be wired to the CEO agent (is_department_head=true and department=''ceo''). Got is_department_head=%, department=%',
      v_is_head, v_dept;
  end if;
  return new;
end;
$fn$;

drop trigger if exists rgaios_agent_telegram_bots_ceo_only
  on rgaios_agent_telegram_bots;

create trigger rgaios_agent_telegram_bots_ceo_only
  before insert or update of agent_id on rgaios_agent_telegram_bots
  for each row execute function rgaios_assert_bot_agent_is_ceo();

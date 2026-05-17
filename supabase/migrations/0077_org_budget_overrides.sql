-- 0077: per-org chat budget tier overrides (rgaios_organization_budget_overrides).
--
-- F-7. Today computeChatBudget() (src/lib/agent/context.ts) reads a
-- single global tier from budget-policy.config.json (ceo / deptHead
-- / specialist). Every org runs the same caps. Customers on bigger
-- plans need bigger context windows; customers on smaller plans
-- need tighter caps to stay under spend.
--
-- This table is the per-org override sink. One row per (org, role)
-- pair. NULL row for a (org, role) pair = fall back to the global
-- config default. Admin UI lives at /admin/budget-overrides.
--
-- Wiring into computeChatBudget is an A-lane follow-up (consumer
-- side touches src/lib/agent). This migration ships the table +
-- helper SQL so C can land production-ready storage independently.
--
-- Service-role writers (admin API route, future ops dashboard)
-- bypass RLS. anon-key admin reads + writes go through the
-- standard org-scoped policy.
--
-- Idempotent: IF NOT EXISTS / DROP IF EXISTS throughout.

create table if not exists rgaios_organization_budget_overrides (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references rgaios_organizations(id) on delete cascade,
  role             text not null check (role in ('ceo', 'deptHead', 'specialist')),
  budget_tokens    integer not null check (budget_tokens > 0 and budget_tokens <= 1000000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, role)
);

create index if not exists rgaios_org_budget_overrides_org_idx
  on rgaios_organization_budget_overrides (organization_id);

-- ─── updated_at touch ─────────────────────────────────────────────
create or replace function rgaios_org_budget_overrides_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rgaios_org_budget_overrides_touch
  on rgaios_organization_budget_overrides;
create trigger rgaios_org_budget_overrides_touch
  before update on rgaios_organization_budget_overrides
  for each row execute function rgaios_org_budget_overrides_touch();

-- ─── RLS ──────────────────────────────────────────────────────────
alter table rgaios_organization_budget_overrides enable row level security;
alter table rgaios_organization_budget_overrides force row level security;
drop policy if exists rgaios_v3_org_budget_overrides_isolation
  on rgaios_organization_budget_overrides;
create policy rgaios_v3_org_budget_overrides_isolation
  on rgaios_organization_budget_overrides
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());

-- ─── Lookup helper ────────────────────────────────────────────────
-- Returns the override budget for a given (org, role) pair, or NULL
-- if no override is set. Consumer (computeChatBudget) coalesces to
-- the global config default. SQL helper keeps the round-trip cheap
-- (one query per chat turn instead of three).
create or replace function rgaios_org_budget_override(
  p_organization_id uuid,
  p_role            text
)
returns integer
language sql
stable
as $$
  select budget_tokens
    from rgaios_organization_budget_overrides
   where organization_id = p_organization_id
     and role = p_role
   limit 1;
$$;

-- Bulk fetch all overrides for one org. Used by the admin page +
-- by the chat route per turn (one round-trip, three roles).
create or replace function rgaios_org_budget_overrides_for(
  p_organization_id uuid
)
returns table (role text, budget_tokens integer)
language sql
stable
as $$
  select role, budget_tokens
    from rgaios_organization_budget_overrides
   where organization_id = p_organization_id;
$$;

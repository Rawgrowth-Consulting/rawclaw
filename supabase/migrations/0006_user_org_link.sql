-- Tie users to an organization. This column was manually added on the
-- hosted Supabase project but never captured in a migration file — so
-- fresh self-hosted databases didn't have it. Idempotent: safe to run on
-- any environment.

alter table rgaios_users
  add column if not exists organization_id uuid
    references rgaios_organizations(id) on delete set null;

create index if not exists idx_rgaios_users_org
  on rgaios_users(organization_id);

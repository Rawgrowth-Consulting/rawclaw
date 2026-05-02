-- Mini SaaS apps. Chris's vision: "they have an engineering team so
-- they can build out their own little mini SaaS applications". The
-- Engineering Manager (+ Backend/Frontend/QA Engineer sub-agents)
-- generates a self-contained single-page web app from a prompt,
-- which the operator previews in an iframe sandbox + iterates on.
--
-- v0 keeps it as one HTML+JS+CSS bundle (no real deploy target) so
-- the loop is: prompt -> generate -> preview -> regenerate. Future:
-- compile to a real /apps/<id> route + persist user data per app.

create table if not exists rgaios_mini_saas (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  title           text not null,
  description     text,
  prompt          text not null,
  generated_html  text,
  status          text not null default 'draft',
  generation_meta jsonb not null default '{}'::jsonb,
  created_by_agent_id uuid references rgaios_agents(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_rgaios_mini_saas_org
  on rgaios_mini_saas (organization_id, created_at desc);

alter table rgaios_mini_saas enable row level security;

-- Service-role bypasses; user policies optional (we gate at the API
-- route layer via getOrgContext, same pattern as the other tables).
drop policy if exists "service_full_access_mini_saas" on rgaios_mini_saas;
create policy "service_full_access_mini_saas" on rgaios_mini_saas
  for all using (true) with check (true);

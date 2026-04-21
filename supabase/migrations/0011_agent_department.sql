-- Agents are organized into one of the four business pillars (departments):
-- marketing, sales, fulfilment, finance. Nullable — agents can be unassigned.

alter table rgaios_agents
  add column if not exists department text
    check (department in ('marketing', 'sales', 'fulfilment', 'finance'));

create index if not exists idx_rgaios_agents_department
  on rgaios_agents(organization_id, department);

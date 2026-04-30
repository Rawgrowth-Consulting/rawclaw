-- Per-department visibility ACL on org members. Chris brief: a marketing
-- manager invitee should see only the marketing dept, not the whole org.
--
-- Empty array (default) OR isAdmin = no restriction (current behavior).
-- Non-empty array = scope: user only sees agents/stats/dashboards for
-- those department slugs (marketing, sales, fulfilment, finance,
-- development - matches src/lib/agents/seed.ts DEFAULT_AGENT_SEED).

alter table rgaios_organization_memberships
  add column if not exists allowed_departments text[] not null default '{}'::text[];

comment on column rgaios_organization_memberships.allowed_departments is
  'Empty = full visibility. Non-empty = restrict to listed dept slugs.';

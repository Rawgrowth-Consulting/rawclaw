-- Skill assignments. The skill catalog itself is code-defined
-- (src/lib/skills/catalog.ts) — this table just tracks WHICH agent has
-- WHICH skill. skill_id is the catalog id (text), not a foreign key.

create table if not exists rgaios_agent_skills (
  agent_id        uuid not null references rgaios_agents(id) on delete cascade,
  skill_id        text not null,
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (agent_id, skill_id)
);

create index if not exists idx_rgaios_agent_skills_org
  on rgaios_agent_skills(organization_id);

create index if not exists idx_rgaios_agent_skills_skill
  on rgaios_agent_skills(organization_id, skill_id);

-- 0044_kalendly.sql
-- Bespoke Calendly-style scheduling. Multi-tenant by organization_id.
-- Ported from albertshiney/kalendly_public (MIT) - Mongo->Postgres,
-- single-tenant->per-org with RLS via org_id.

create extension if not exists "pgcrypto";

-- Per-org Google Calendar binding. Connection itself lives in
-- rgaios_connections (Nango); this row picks WHICH calendar to write to.
create table if not exists rgaios_kalendly_calendar_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  calendar_id text not null,
  calendar_summary text not null,
  default_timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id)
);

-- Event type = bookable slot definition (e.g. "30-min discovery call").
create table if not exists rgaios_kalendly_event_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  slug text not null,
  title text not null,
  description text not null default '',
  duration_minutes int not null check (duration_minutes between 5 and 480),
  color text not null default 'sage',
  location jsonb not null,
  rules jsonb not null,
  custom_questions jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  position int not null default 0,
  -- Optional: pin event type to specific agent (SDR/sales-mgr/etc).
  -- When set, booking confirmation pings that agent + their telegram.
  agent_id uuid references rgaios_agents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

-- Weekly hours + date overrides per org. One row per org for now;
-- future: per-agent availability if Chris asks for round-robin.
create table if not exists rgaios_kalendly_availability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  timezone text not null default 'UTC',
  weekly_hours jsonb not null default '[]'::jsonb,
  date_overrides jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (organization_id)
);

-- Bookings: what was actually scheduled.
create table if not exists rgaios_kalendly_bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  event_type_id uuid not null references rgaios_kalendly_event_types(id) on delete cascade,
  event_type_slug text not null,
  guest_name text not null,
  guest_email text not null,
  guest_timezone text not null,
  custom_answers jsonb not null default '{}'::jsonb,
  start_utc timestamptz not null,
  end_utc timestamptz not null,
  google_event_id text,
  meet_link text,
  manage_token text not null unique,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'rescheduled')),
  rescheduled_to_booking_id uuid references rgaios_kalendly_bookings(id) on delete set null,
  -- Hooks into v3:
  -- - if event_type.agent_id set, pin to that agent
  -- - on confirmed: telegram_notify(agent.telegram_chat_id) via dispatch
  -- - on cancelled: same
  -- - on confirmed: optional sales_call row pre-created (P2 #12)
  notified_agent_at timestamptz,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index if not exists idx_kalendly_bookings_org_start
  on rgaios_kalendly_bookings (organization_id, start_utc);

create index if not exists idx_kalendly_bookings_event_type
  on rgaios_kalendly_bookings (event_type_id, status);

create index if not exists idx_kalendly_bookings_manage_token
  on rgaios_kalendly_bookings (manage_token);

-- RLS: each table is org-scoped. Existing pattern: deny by default,
-- service-role bypasses, app reads filter by org_id from JWT.
alter table rgaios_kalendly_calendar_bindings enable row level security;
alter table rgaios_kalendly_event_types enable row level security;
alter table rgaios_kalendly_availability enable row level security;
alter table rgaios_kalendly_bookings enable row level security;

drop policy if exists kalendly_bindings_org_select on rgaios_kalendly_calendar_bindings;
create policy kalendly_bindings_org_select on rgaios_kalendly_calendar_bindings
  for all
  using (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', ''))
  with check (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', ''));

drop policy if exists kalendly_event_types_org_select on rgaios_kalendly_event_types;
create policy kalendly_event_types_org_select on rgaios_kalendly_event_types
  for all
  using (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', ''))
  with check (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', ''));

drop policy if exists kalendly_availability_org_select on rgaios_kalendly_availability;
create policy kalendly_availability_org_select on rgaios_kalendly_availability
  for all
  using (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', ''))
  with check (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', ''));

drop policy if exists kalendly_bookings_org_select on rgaios_kalendly_bookings;
create policy kalendly_bookings_org_select on rgaios_kalendly_bookings
  for all
  using (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', ''))
  with check (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', ''));

-- Public booking endpoint reads event type + availability for ANY org via
-- service-role (bypasses RLS). The /book/[orgSlug] page is intentionally
-- public.

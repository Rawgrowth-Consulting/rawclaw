-- Auto-deploy on payment scaffold (P2 #9, plan wiggly-hugging-sutherland §9).
--
-- Stripe webhook → row appears here in status='pending'. Operator (or future
-- worker) drives provision-vps.sh, then flips status to 'ready' (or 'error')
-- once the VPS is up. The /portal/[id] page polls this table to render the
-- "we're spinning up your Raw Claw" status to the buyer.
--
-- This is a SCAFFOLD: the webhook + queue row + status portal are real,
-- but the actual VPS spin-up still runs operator-side via provision-vps.sh.
-- See DEPLOY-V3.md "Auto-deploy roadmap" for the path to full automation.
--
-- State machine:
--   pending      → webhook received, no provisioning started
--   provisioning → operator/worker has picked the row
--   ready        → VPS up, dashboard_url populated, email sent
--   error        → terminal failure, error column has the reason
--   cancelled    → buyer cancelled before provision (refund flow)

create table if not exists rgaios_provisioning_queue (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid references rgaios_organizations(id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,
  owner_email            text not null,
  owner_name             text,
  plan_name              text,
  status                 text not null default 'pending'
                           check (status in ('pending','provisioning','ready','error','cancelled')),
  vps_host               text,
  vps_url                text,
  dashboard_url          text,
  error                  text,
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Only one open queue row per buyer email at a time (prevents duplicate
-- provisioning if Stripe re-delivers the webhook). Terminal states
-- ('error','cancelled') are excluded so a retry after failure works.
create unique index if not exists rgaios_provisioning_queue_email_uniq
  on rgaios_provisioning_queue (lower(owner_email))
  where status in ('pending','provisioning','ready');

create index if not exists rgaios_provisioning_queue_status_idx
  on rgaios_provisioning_queue (status, created_at desc);

create index if not exists rgaios_provisioning_queue_stripe_sub_idx
  on rgaios_provisioning_queue (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- updated_at auto-touch.
drop trigger if exists tr_rgaios_provisioning_queue_updated_at on rgaios_provisioning_queue;
create trigger tr_rgaios_provisioning_queue_updated_at
  before update on rgaios_provisioning_queue
  for each row execute function rgaios_set_updated_at();

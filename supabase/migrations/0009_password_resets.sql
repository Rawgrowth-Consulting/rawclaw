-- Password reset tokens. This table was created manually on the hosted
-- Supabase DB but was never captured in a migration file — so fresh
-- self-hosted databases didn't have it and forgot-password silently
-- errored with "Failed to create reset". Idempotent.

create table if not exists rgaios_password_resets (
  token_hash  text primary key,
  user_id     uuid not null references rgaios_users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_rgaios_password_resets_user
  on rgaios_password_resets(user_id);

-- Race-free dedup for /api/cron/atlas-coordinate.
--
-- Without this two callers (Vercel daily cron + the lazy SWR-poll
-- trigger in /api/notifications/agents) can both pass the
-- "no msg in the last 14 min" check in the same millisecond and emit
-- duplicate Atlas notifications. The audit on 2026-05-05 caught this:
-- two identical "Heartbeat 20:20" rows landed at 16:20:25 for one org.
--
-- Approach: a UNIQUE index on (organization_id, lock_bucket) where
-- lock_bucket = floor(extract(epoch from created_at) / 600), i.e. 10
-- minute buckets. Atlas writes with metadata.kind='atlas_coordinate'
-- always go through this index; conflicting writes inside the same
-- bucket are absorbed by ON CONFLICT DO NOTHING in the route handler.

create or replace function rgaios_atlas_coordinate_bucket(t timestamptz)
  returns bigint language sql immutable as $$
  select floor(extract(epoch from t) / 600)::bigint
$$;

-- Remove pre-existing duplicates so the unique index can land. Keep
-- the oldest row per (org, 10-min bucket) - newest dupes get pruned.
delete from rgaios_agent_chat_messages a
 using rgaios_agent_chat_messages b
 where a.metadata->>'kind' = 'atlas_coordinate'
   and b.metadata->>'kind' = 'atlas_coordinate'
   and a.organization_id = b.organization_id
   and rgaios_atlas_coordinate_bucket(a.created_at)
       = rgaios_atlas_coordinate_bucket(b.created_at)
   and a.created_at > b.created_at;

create unique index if not exists rgaios_atlas_coord_dedup_idx
  on rgaios_agent_chat_messages (
    organization_id,
    rgaios_atlas_coordinate_bucket(created_at)
  )
  where metadata->>'kind' = 'atlas_coordinate';

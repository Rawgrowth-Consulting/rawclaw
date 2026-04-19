-- Full-text search column + GIN index for drive_file_chunks.
-- Drizzle can't express generated tsvector columns, so we run this once
-- after `npx drizzle-kit push` has created the base tables.
--
-- Idempotent: safe to run multiple times.

alter table drive_file_chunks
  add column if not exists text_search tsvector
  generated always as (to_tsvector('english', text)) stored;

create index if not exists drive_file_chunks_fts_idx
  on drive_file_chunks using gin (text_search);

-- Secondary index for ordering/filtering
create index if not exists drive_files_modified_idx
  on drive_files (modified_at desc);

create index if not exists drive_file_chunks_file_idx
  on drive_file_chunks (file_id);

create index if not exists audit_log_ts_idx
  on audit_log (ts desc);

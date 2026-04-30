-- Plan §7. Unified company DB corpus.
--
-- The trial-era "company DB" is split across four sources:
--   - rgaios_brand_intakes      (onboarding answers, JSONB)
--   - rgaios_brand_profiles     (generated markdown profile)
--   - rgaios_scrape_snapshots   (social/competitor/site scrapes)
--   - rgaios_onboarding_documents (file metadata; bytes in storage)
--   - rgaios_sales_calls        (transcribed calls, plan §12)
--   - rgaios_agent_files        (per-agent uploads, mirrored optionally)
--
-- Chris's spec: "everything about their business in one Supabase vector
-- store". To keep the demo path simple and the embedding column truly
-- canonical, we union by INGESTING into a single table rather than a SQL
-- view. The table rgaios_company_chunks already exists from migration
-- 0040 (sales_calls landed first). This migration is idempotent and:
--
--   1. Re-asserts the table shape via `if not exists` so a freshly
--      provisioned VPS that runs the migrations from scratch still ends
--      up with the same store regardless of order.
--   2. Adds the (organization_id, source) compound index spec'd in plan
--      §7 (0040 already created an equivalent one; `if not exists`
--      makes the re-add a no-op there).
--   3. Defines the rgaios_match_company_chunks RPC mirroring the
--      rgaios_match_agent_chunks pattern from 0027. Cosine top-K with
--      a min-similarity floor and source/source_id passthrough so the
--      caller can group hits by origin (intake / brand / scrape / call).
--
-- Naming: the rgaios_ prefix is consistent with all other RPCs in this
-- repo (0027). The function takes p_org_id explicitly rather than
-- leaning on rgaios_current_org_id() because the MCP route runs under
-- the service-role key (RLS bypassed) and passes ctx.organizationId
-- directly, same pattern as match_agent_chunks.

create extension if not exists vector;

create table if not exists rgaios_company_chunks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  source          text not null,
  source_id       uuid,
  chunk_index     int not null default 0,
  content         text not null,
  token_count     int,
  embedding       vector(1536),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_rgaios_company_chunks_org
  on rgaios_company_chunks (organization_id, source);

create index if not exists idx_rgaios_company_chunks_source_id
  on rgaios_company_chunks (source, source_id);

create index if not exists idx_rgaios_company_chunks_embedding
  on rgaios_company_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

alter table rgaios_company_chunks enable row level security;
alter table rgaios_company_chunks force row level security;
drop policy if exists rgaios_v3_company_chunks_org_isolation on rgaios_company_chunks;
create policy rgaios_v3_company_chunks_org_isolation on rgaios_company_chunks
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());

-- Top-K cosine retrieval. Mirrors rgaios_match_agent_chunks (0027) but
-- scoped to the org-wide rgaios_company_chunks store and exposes
-- source / source_id / metadata so callers can label hits by origin
-- (intake answer vs brand profile vs scrape snapshot vs sales call).
create or replace function rgaios_match_company_chunks(
  p_org_id           uuid,
  p_query_embedding  vector(1536),
  p_match_count      int default 5,
  p_min_similarity   float default 0.0
)
returns table (
  id          uuid,
  source      text,
  source_id   uuid,
  chunk_text  text,
  similarity  float,
  metadata    jsonb
)
language sql stable as $$
  select
    c.id,
    c.source,
    c.source_id,
    c.content as chunk_text,
    1.0 - (c.embedding <=> p_query_embedding) as similarity,
    c.metadata
  from rgaios_company_chunks c
  where c.organization_id = p_org_id
    and c.embedding is not null
    and 1.0 - (c.embedding <=> p_query_embedding) >= p_min_similarity
  order by c.embedding <=> p_query_embedding
  limit greatest(p_match_count, 1)
$$;

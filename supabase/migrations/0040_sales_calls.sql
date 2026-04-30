-- Sales-call ingestion (Plan §12).
--
-- Onboarding lets the client drop in audio recordings (mp3/m4a/webm) or
-- paste a Loom/Fireflies/Gong URL. The /api/onboarding/sales-calls/upload
-- route writes one row per call here, runs Whisper (or the Anthropic
-- audio fallback in src/lib/voice/transcribe.ts), then chunks + embeds
-- the transcript into rgaios_agent_file_chunks tagged with metadata
-- {source: 'sales_call', sales_call_id} so the company-corpus retriever
-- (Plan §7) can surface objections, pricing pushback, etc. when an
-- agent is asked things like "what does the prospect say about price".
--
-- Kept lean for trial - no provider-specific columns. Loom/Fireflies/Gong
-- ingestion is the next step; URL rows land here with status='error'
-- and error='url ingestion not yet implemented' until we wire the
-- per-provider transcript fetchers.

create table if not exists rgaios_sales_calls (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  source_type     text not null check (source_type in ('audio_upload','loom','fireflies','gong','other_url')),
  source_url      text,
  filename        text,
  transcript      text,
  duration_sec    integer,
  status          text not null default 'pending' check (status in ('pending','transcribing','ready','error')),
  metadata        jsonb not null default '{}'::jsonb,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists rgaios_sales_calls_org_idx
  on rgaios_sales_calls (organization_id, created_at desc);

-- RLS: org isolation, mirroring rgaios_onboarding_documents (0020).
alter table rgaios_sales_calls enable row level security;
alter table rgaios_sales_calls force row level security;
drop policy if exists rgaios_v3_sales_calls_org_isolation on rgaios_sales_calls;
create policy rgaios_v3_sales_calls_org_isolation on rgaios_sales_calls
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());

-- updated_at auto-touch.
drop trigger if exists tr_rgaios_sales_calls_updated_at on rgaios_sales_calls;
create trigger tr_rgaios_sales_calls_updated_at
  before update on rgaios_sales_calls
  for each row execute function rgaios_set_updated_at();

-- ─── Company-wide corpus chunks ─────────────────────────────────
--
-- rgaios_agent_file_chunks.agent_id is NOT NULL (see 0026), so we
-- can't reuse it for org-wide content. This table stores chunks that
-- belong to the whole organization and are tagged by source so the
-- (planned) v_company_corpus view (§7) can union across them.
--
-- Sources land here from:
--   - sales calls (this migration: source='sales_call', metadata.sales_call_id)
--   - future: scraped social, intake summaries, brand profile, etc.
--
-- Same vector(1536) shape + ivfflat index as rgaios_agent_file_chunks
-- so the existing fastembed/openai/voyage embedder pipeline plugs in
-- unchanged.

create table if not exists rgaios_company_chunks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  source          text not null,                  -- 'sales_call' | 'scrape' | 'intake' | 'brand_profile' | ...
  source_id       uuid,                           -- fk into the source table (e.g. rgaios_sales_calls.id)
  chunk_index     int not null,
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
  on rgaios_company_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

alter table rgaios_company_chunks enable row level security;
alter table rgaios_company_chunks force row level security;
drop policy if exists rgaios_v3_company_chunks_org_isolation on rgaios_company_chunks;
create policy rgaios_v3_company_chunks_org_isolation on rgaios_company_chunks
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());

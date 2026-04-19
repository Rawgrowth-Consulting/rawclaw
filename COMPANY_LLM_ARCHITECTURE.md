# Company LLM Architecture

How Rawgrowth turns a customer's connected tools into a private, queryable knowledge layer that's both **trustworthy** (source-addressable, citation-backed) and **fast** (hybrid retrieval, structured + semantic).

This is an opinionated reference document. The pattern follows Karpathy's "llm-wiki" model — raw sources stay immutable, the wiki is derived, every claim traces back to a specific source — adapted for a multi-tenant SaaS, with concrete table definitions for the integrations Rawgrowth ships first (Gmail, Fathom, Shopify).

---

## Architectural Principles

Seven non-negotiables. Everything below is a consequence of these.

1. **Source-addressable.** Nothing exists in the knowledge layer that can't be traced back to a specific chunk in a specific email, doc, transcript, or order row.
2. **Derived, not stored.** The wiki is *computed* from sources. Wipe everything except `bronze_*` tables and the system rebuilds itself.
3. **Citations mandatory.** Every LLM-generated artifact (summary, answer, entity description) carries `[^N]` markers that resolve to source chunks. Enforced in the system prompt and validated on output.
4. **Per-tenant by construction.** `company_id` is a non-null column on every table. Every query filters on it. RLS policies enforce it server-side. One bug here = lawsuit.
5. **Append-only on bronze.** Source records are never mutated in place — re-fetched records are upserted by `(company_id, source_id)`, with `source_version` and `fetched_at` tracking history.
6. **Idempotent ingest.** Replaying any sync is safe. Re-processing the same Gmail history page produces zero duplicates.
7. **Hybrid retrieval.** Semantic (vectors) + identity (B-tree on names/emails) + structural (entity-mention graph). Pure vector search is not enough for enterprise data.

---

## The Medallion Layers

Three layers. Each layer is fully derivable from the layer below it.

```
┌─────────────────────────────────────────────────────────────────┐
│  GOLD — Knowledge graph + compiled answers                      │
│    entities, entity_mentions, answers                           │
│    (LLM-generated, cached, citation-backed)                     │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ derived from
┌──────────────────────────────────┴──────────────────────────────┐
│  SILVER — Normalised, queryable, embedded                       │
│    Structured mirrors:  gmail_messages, fathom_meetings,        │
│                         shopify_orders, ...                     │
│    Content chunks:      gmail_message_chunks (+ embedding),     │
│                         fathom_transcript_chunks (+ embedding), │
│                         drive_doc_chunks (+ embedding)          │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ derived from
┌──────────────────────────────────┴──────────────────────────────┐
│  BRONZE — Raw, immutable, source-of-truth                       │
│    bronze_gmail_messages, bronze_drive_files,                   │
│    bronze_fathom_meetings, bronze_shopify_orders, ...           │
│    Stores the API payload verbatim. Idempotent on               │
│    (company_id, source_id). Never mutated.                      │
└─────────────────────────────────────────────────────────────────┘
```

| Layer | Karpathy-equivalent | Mutability | Re-derivable from |
| --- | --- | --- | --- |
| Bronze | Raw sources | Append-only / idempotent upsert | The source API itself |
| Silver | (still raw, just normalised) | Recomputable from bronze | Bronze |
| Gold | Structured wiki | Recomputable from silver | Silver + system prompts |

---

## The Pipeline (8 stages)

Each stage is its own durable workflow step (Vercel Workflow / Inngest). Steps are idempotent and resumable.

### 1. Ingest

OAuth connectors and API-key clients pull from the source. Two patterns:

- **Push** (preferred where supported) — webhook fires, payload lands in bronze. Used by: Stripe, Shopify, Fathom, HubSpot.
- **Pull** — scheduled poll fetches new records since `last_synced_at`. Used by: Gmail (history feed), Drive (changes API), Notion.

Either way, the raw payload is upserted into the corresponding `bronze_*` table keyed on `(company_id, source_id)`. Source metadata (authors, timestamps, permissions, etag) is preserved.

### 2. Normalise (silver mirror)

A normalisation worker reads new bronze rows, extracts structured columns into the silver mirror table. Example: `bronze_gmail_messages.payload->'headers'` becomes `gmail_messages.from`, `to`, `subject` as proper columns. SQL queries hit the silver table; the LLM doesn't see bronze.

### 3. Chunk + embed

Unstructured content (email bodies, transcript text, doc contents) is:

- Split into ~3200-char chunks (token-aware, paragraph-respecting). For transcripts, prefer speaker-turn boundaries.
- Embedded with `text-embedding-3-large` at 1536 dimensions (or `text-embedding-3-small` at 1536 if cost matters more than quality).
- Inserted into the chunk table with the embedding column + the `(company_id, source_id, position)` composite key.

Each chunk table has an HNSW index on the embedding column scoped by `company_id` (more on isolation below).

### 4. Extract + resolve (entities)

Claude Haiku scans each new chunk and proposes typed entities with excerpts. The extractor prompt enumerates valid kinds:

```
VALID_KINDS = "Person" | "Org" | "Topic" | "Product" | "Project" | "Location"
```

Entities deduplicate on `(company_id, kind, lower(name))`. Mentions are inserted as `(entity_id → source chunk_id)` with the verbatim excerpt that justified the link. The mention table is the **structural index** — it's a graph.

### 5. Compile (entity summaries + answers)

On demand, Claude Sonnet generates a summary for an entity (e.g. for the entity page at `/entities/[id]`):

- Pulls the top N mentions for that entity (by recency × relevance).
- Generates a summary with `[^N]` citations referring back to source chunks.
- Caches in `answers` table keyed on `(company_id, entity_id, source_version)`.

When new mentions arrive, `source_version` increments and the cache is auto-invalidated. Lazy compilation: entities only get summarised when first viewed.

### 6. Index (three layers)

| Index | Implementation | Used for |
| --- | --- | --- |
| **Semantic** | pgvector HNSW on each `*_chunks.embedding` column | "find chunks similar to this question" |
| **Identity** | Postgres B-tree + `ILIKE` on `entities.name`, `silver.from_email`, etc. | "find anything mentioning Acme Corp" |
| **Structural** | The `entity_mentions` table itself + foreign keys | "show all sources that link Person:John to Project:Q4-Migration" |

A single SQL function — `match_chunks(company_id, query_embedding, k)` — UNIONs top-K from each chunk table by cosine similarity, returning a unified result set with chunk text + back-reference to source.

### 7. Query

Two query surfaces, same retrieval path:

- **Interactive** — user asks something via Claude Desktop / Cursor / Telegram. The MCP server tool is invoked.
- **Agent-driven** — a Routine fires; the agent's reasoning loop calls the same MCP tools.

Either way:

1. The question is embedded (same model used at ingest).
2. `match_chunks` runs filtered by `company_id` first.
3. Top results are passed to Claude Sonnet with a citation-mandatory system prompt.
4. The answer is returned with `[^N]` citation markers that resolve to source URLs.

### 8. Navigate

Every answer, every entity page, every citation chip links back to the original source — Drive doc, Gmail thread, Fathom transcript timestamp, Shopify order page in their admin. The wiki **never replaces** the source of truth; it derives from it.

---

## Per-Tenant Isolation

This is the single most important non-functional requirement.

### Storage isolation

- `company_id uuid not null` on every silver, gold, and bronze table.
- Postgres Row-Level Security policies on all tables: `USING (company_id = current_setting('app.current_company_id')::uuid)`.
- The application sets `app.current_company_id` per request inside a transaction. Connection pool reuse can't leak across tenants.

### Vector isolation

Naive HNSW search ignores company_id at index level — it'd return chunks from other companies as nearest neighbours. Two viable solutions:

- **Pre-filter**: HNSW with `WHERE company_id = $1` first; the index supports this via the `iterative_scan` GUC. Works for moderate tenant counts.
- **Per-tenant partial indexes**: For high-volume tenants, build a separate HNSW index per company. More expensive but strict isolation.

We start with pre-filter; switch to partial indexes when a tenant's chunk count exceeds a threshold (e.g. 1M chunks).

### Secrets isolation

API keys and OAuth tokens are encrypted with a per-tenant data key (envelope encryption against a master KMS key). A tenant compromise can't decrypt another tenant's secrets even if the DB leaks.

---

## Concrete Schemas

DDL examples for the first three integrations Rawgrowth ships. Postgres + pgvector dialect.

### Bronze (raw, immutable)

```sql
-- Generic shape, repeated per source
create table bronze_gmail_messages (
  company_id        uuid not null,
  source_id         text not null,            -- Gmail's message id
  thread_id         text not null,
  raw_payload       jsonb not null,           -- the full Gmail API response
  source_etag       text,
  source_updated_at timestamptz,
  fetched_at        timestamptz not null default now(),
  primary key (company_id, source_id)
);

create table bronze_fathom_meetings (
  company_id        uuid not null,
  source_id         text not null,            -- Fathom meeting id
  raw_payload       jsonb not null,           -- includes transcript array
  source_updated_at timestamptz,
  fetched_at        timestamptz not null default now(),
  primary key (company_id, source_id)
);

create table bronze_shopify_orders (
  company_id        uuid not null,
  source_id         text not null,            -- Shopify order id
  raw_payload       jsonb not null,
  source_updated_at timestamptz,
  fetched_at        timestamptz not null default now(),
  primary key (company_id, source_id)
);
```

### Silver — structured mirrors (queryable via SQL)

```sql
create table gmail_messages (
  company_id     uuid not null,
  message_id     text not null,
  thread_id      text not null,
  from_email     text not null,
  from_name      text,
  to_emails      text[] not null,
  cc_emails      text[],
  subject        text,
  received_at    timestamptz not null,
  has_attachments boolean not null default false,
  labels         text[],
  source_version int  not null default 1,
  primary key (company_id, message_id)
);
create index gmail_messages_company_received_idx
  on gmail_messages (company_id, received_at desc);

create table fathom_meetings (
  company_id     uuid not null,
  meeting_id     text not null,
  title          text,
  started_at     timestamptz not null,
  ended_at       timestamptz,
  duration_sec   int,
  participants   jsonb not null,             -- [{email, name, internal}]
  recording_url  text,
  source_version int  not null default 1,
  primary key (company_id, meeting_id)
);

create table shopify_orders (
  company_id        uuid not null,
  order_id          text not null,
  customer_id       text,
  created_at        timestamptz not null,
  total_price       numeric(12, 2),
  currency          text,
  financial_status  text,
  fulfillment_status text,
  line_items        jsonb not null,
  shipping_country  text,
  source_version    int not null default 1,
  primary key (company_id, order_id)
);
create index shopify_orders_company_created_idx
  on shopify_orders (company_id, created_at desc);
```

### Silver — chunks with embeddings

```sql
create extension if not exists vector;

create table gmail_message_chunks (
  company_id  uuid not null,
  chunk_id    uuid not null default gen_random_uuid(),
  message_id  text not null,
  position    int  not null,                 -- 0-indexed within message
  text        text not null,
  embedding   vector(1536) not null,
  primary key (company_id, chunk_id),
  foreign key (company_id, message_id) references gmail_messages
);
create index gmail_message_chunks_hnsw
  on gmail_message_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create table fathom_transcript_chunks (
  company_id  uuid not null,
  chunk_id    uuid not null default gen_random_uuid(),
  meeting_id  text not null,
  speaker     text,
  start_sec   numeric,
  end_sec     numeric,
  text        text not null,
  embedding   vector(1536) not null,
  primary key (company_id, chunk_id),
  foreign key (company_id, meeting_id) references fathom_meetings
);
create index fathom_chunks_hnsw
  on fathom_transcript_chunks using hnsw (embedding vector_cosine_ops);

-- Shopify products get chunked descriptions; orders are queried via SQL only.
create table shopify_product_chunks (
  company_id  uuid not null,
  chunk_id    uuid not null default gen_random_uuid(),
  product_id  text not null,
  text        text not null,
  embedding   vector(1536) not null,
  primary key (company_id, chunk_id)
);
```

### Gold — entities, mentions, compiled answers

```sql
create type entity_kind as enum
  ('Person', 'Org', 'Topic', 'Product', 'Project', 'Location');

create table entities (
  company_id  uuid not null,
  entity_id   uuid not null default gen_random_uuid(),
  kind        entity_kind not null,
  name        text not null,
  aliases     text[] not null default '{}',
  metadata    jsonb,                         -- e.g. { "email": "...", "domain": "..." }
  source_version int not null default 1,
  primary key (company_id, entity_id),
  unique (company_id, kind, lower(name))
);

create table entity_mentions (
  company_id     uuid not null,
  mention_id     uuid not null default gen_random_uuid(),
  entity_id      uuid not null,
  source_table   text not null,              -- 'gmail_message_chunks', 'fathom_transcript_chunks', etc.
  source_chunk_id uuid not null,
  excerpt        text not null,              -- the verbatim excerpt that justified the link
  confidence     numeric,                    -- 0..1 from the extractor
  created_at     timestamptz not null default now(),
  primary key (company_id, mention_id),
  foreign key (company_id, entity_id) references entities
);
create index entity_mentions_entity_idx
  on entity_mentions (company_id, entity_id);

create table answers (
  company_id     uuid not null,
  answer_id      uuid not null default gen_random_uuid(),
  scope          text not null,              -- 'entity:<id>' | 'question:<hash>'
  body_md        text not null,              -- contains [^N] citation markers
  citations      jsonb not null,             -- [{ n: 1, source_table, source_chunk_id, source_url }]
  source_version int not null,               -- snapshot of relevant source state
  generated_by   text not null,              -- 'claude-sonnet-4-5'
  created_at     timestamptz not null default now(),
  primary key (company_id, answer_id),
  unique (company_id, scope, source_version)
);
```

---

## What gets stored, per integration

What ends up in bronze, silver, and which chunks get embedded:

| Integration | Bronze | Silver structured | Silver chunks (embedded) |
| --- | --- | --- | --- |
| Gmail | full message JSON | from/to/subject/received/labels | message body chunks |
| Fathom | meeting JSON inc. transcript | meeting metadata + participants | transcript chunks (per speaker turn) + AI summary |
| Drive | file metadata + content | file row per doc/sheet/slide | doc body chunks |
| Notion | page JSON | page metadata + parent | page body chunks |
| Shopify | order/customer/product JSON | full structured tables | product description chunks (orders not embedded) |
| Stripe | charge/subscription JSON | structured tables | not embedded (numeric only) |
| HubSpot | contact/deal/note JSON | structured tables | deal notes + emails chunks |
| Slack | message JSON | message metadata + channel | message body chunks |
| Mailchimp | campaign + list JSON | structured tables | campaign body chunks |
| GA / Meta | report responses | structured tables (numeric) | not embedded |

Rule of thumb: if it's quantitative, store it structured and query it via SQL — don't embed numbers. If it's prose, chunk and embed.

---

## MCP Tool Surface

The MCP server exposes the knowledge layer through *tools*, not raw chunks or raw SQL. The LLM (whether in-app agent or external Claude Desktop) sees these signatures only.

```
# Cross-cutting
get_client_context(name: string) -> Bundle
  -> fans out to gmail_messages, fathom_meetings, shopify_orders,
     hubspot_deals; returns a structured blob with citations.

ask(question: string) -> AnswerWithCitations
  -> embeds, runs match_chunks, calls Sonnet with citation-mandatory prompt.

# Gmail
search_emails(query: string, from_email?, date_range?) -> EmailSnippet[]
get_thread(thread_id: string) -> Thread

# Fathom
find_meetings(participant?, topic?, date_range?) -> Meeting[]
get_transcript_snippet(meeting_id, topic_query) -> TranscriptChunks

# Shopify
query_revenue(timeframe, group_by?) -> RevenueSeries
top_customers(since, limit=10) -> Customer[]
search_orders(customer_email?, status?, date_range?) -> Order[]

# Entity-graph
find_entity(name, kind?) -> Entity[]
entity_mentions(entity_id, since?) -> Mention[]
get_entity_summary(entity_id) -> AnswerWithCitations
```

Every tool that returns LLM-derived content includes citation pointers; the calling agent is expected to surface them.

---

## Cost Model (rough orders of magnitude)

For a mid-sized client (~50 seats, ~200 emails/day/user, ~30 meetings/week, modest Shopify volume):

| Cost line | Driver | Approx |
| --- | --- | --- |
| Embeddings (text-embedding-3-large) | ingest, ~10K new chunks/day | $0.50–$2/day |
| Embeddings (queries) | ~5K interactive queries/day | $0.05/day |
| Storage (Neon Postgres + pgvector) | ~50GB/year per heavy tenant | $20–$50/mo |
| Entity extraction (Claude Haiku) | per new chunk | $0.50–$2/day |
| Entity summaries (Claude Sonnet) | lazy, on view | usage-based |
| **Interactive query inference** | **paid by client's Claude subscription via MCP** | **$0 to us** |
| Routine inference (server-side) | per agent run | usage-based, billed to client |

The MCP arbitrage matters: interactive queries are ~70% of LLM token volume in chat-heavy products, and that 70% is offloaded to the client's Claude subscription.

---

## Rebuild & Disaster Recovery

Because everything above bronze is derived, recovery is a re-run away.

- **Lose silver**: replay normaliser + chunker + embedder over bronze. Costs embedding + extraction tokens.
- **Lose gold**: replay extractor + on-demand summariser. Cheap.
- **Lose bronze**: re-fetch from source APIs. Slow (rate limits) but possible because every connector tracks `source_id`.
- **Schema migration**: bump `source_version` on a row to invalidate dependent silver/gold; background workers re-derive.

This is what makes the architecture trustworthy: there is no irreplaceable state above the bronze layer.

---

## Implementation Roadmap (build order)

The order to actually build this. Each step is independently shippable.

1. **Bronze + ingest for one integration** (Gmail or Fathom — pick whichever client traction demands first).
   - OAuth flow + connector
   - `bronze_*` table + idempotent upsert
   - Audit log
2. **Silver mirror** for that integration.
   - Normaliser worker
   - Structured table + indexes
3. **Chunking + embedding pipeline.**
   - Splitter (token-aware)
   - Embedding worker calling `text-embedding-3-large`
   - pgvector HNSW index
4. **Hybrid retrieval.**
   - `match_chunks` SQL function with company_id pre-filter
   - Reranker (small model) on top
5. **Citation-mandatory `ask` endpoint.**
   - System prompt + JSON schema for citations
   - Validator that rejects uncited claims
6. **MCP server skeleton.**
   - Per-tenant URL minted at company creation
   - First tools: `ask`, `search_emails`, `find_meetings`
   - Auth via signed bearer token tied to `company_id`
7. **Repeat 1–4 for the next two integrations.** Reuse splitter, embedder, retrieval — only bronze + normaliser are integration-specific.
8. **Entity layer (gold).**
   - Haiku-based extractor over new chunks
   - `entities` + `entity_mentions` tables
   - Entity pages in the app
9. **Compiled answers + caching.**
   - Sonnet summariser
   - `answers` table with `source_version` invalidation
10. **Per-tenant partial vector indexes** for the largest tenants once any single tenant exceeds ~1M chunks.

Don't try to build all of this at once. Ship #1–#6 to get a working "ask Claude Desktop about my Gmail" demo. Everything else is incremental enrichment.

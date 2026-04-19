import {
  bigint,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * MVP schema — single-tenant. `company_id` columns come in Phase 2
 * when we add multi-tenancy. Matches the bronze/silver/gold layering
 * described in COMPANY_LLM_ARCHITECTURE.md.
 */

// ─── Connections ─────────────────────────────────────────────────────

export const connections = pgTable("connections", {
  integrationId: text("integration_id").primaryKey(), // 'google-drive', ...
  method: text("method").notNull(), // 'oauth' | 'api_key' | 'webhook'
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: bigint("expires_at", { mode: "number" }),
  scopes: text("scopes"),
  accountLabel: text("account_label"),
  apiKey: text("api_key"),
  webhookUrl: text("webhook_url"),
  webhookSecret: text("webhook_secret"),
  connectedAt: bigint("connected_at", { mode: "number" }).notNull(),
});

// ─── Bronze — raw Drive payloads ────────────────────────────────────

export const bronzeDriveFiles = pgTable("bronze_drive_files", {
  fileId: text("file_id").primaryKey(),
  rawPayload: jsonb("raw_payload").notNull(),
  mimeType: text("mime_type").notNull(),
  sourceEtag: text("source_etag"),
  sourceModifiedMs: bigint("source_modified_ms", { mode: "number" }),
  fetchedAt: bigint("fetched_at", { mode: "number" }).notNull(),
});

// ─── Silver — structured + chunked ──────────────────────────────────

export const driveFiles = pgTable("drive_files", {
  fileId: text("file_id").primaryKey(),
  title: text("title").notNull(),
  mimeType: text("mime_type").notNull(),
  webViewLink: text("web_view_link"),
  modifiedAt: bigint("modified_at", { mode: "number" }).notNull(),
  ownerEmail: text("owner_email"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  sourceVersion: integer("source_version").notNull().default(1),
});

/**
 * Text chunks for full-text search. The `text_search` tsvector column
 * + GIN index are added by init.sql (not expressible in Drizzle schema).
 */
export const driveFileChunks = pgTable("drive_file_chunks", {
  chunkId: uuid("chunk_id").primaryKey().defaultRandom(),
  fileId: text("file_id").notNull(),
  position: integer("position").notNull(),
  text: text("text").notNull(),
});

// ─── Sync state + audit ─────────────────────────────────────────────

export const syncState = pgTable("sync_state", {
  integrationId: text("integration_id").primaryKey(),
  cursor: text("cursor"),
  lastRunAt: bigint("last_run_at", { mode: "number" }),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  ts: bigint("ts", { mode: "number" }).notNull(),
  integration: text("integration"),
  kind: text("kind").notNull(),
  detail: jsonb("detail"),
});

// Type exports for convenience
export type Connection = typeof connections.$inferSelect;
export type DriveFile = typeof driveFiles.$inferSelect;

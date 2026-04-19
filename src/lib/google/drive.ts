import { google } from "googleapis";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  bronzeDriveFiles,
  driveFileChunks,
  driveFiles,
  syncState,
} from "@/lib/db/schema";
import { getAuthedClient, logEvent } from "./oauth";

const INTEGRATION_ID = "google-drive";

const TEXT_LIKE_MIMES = new Set([
  "application/vnd.google-apps.document",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

export type SyncSummary = {
  scanned: number;
  ingested: number;
  contentIndexed: number;
  errors: number;
};

export async function syncDrive(
  opts: { maxFiles?: number } = {},
): Promise<SyncSummary> {
  const max = opts.maxFiles ?? 100;
  const auth = await getAuthedClient(INTEGRATION_ID);
  const drive = google.drive({ version: "v3", auth });

  const summary: SyncSummary = {
    scanned: 0,
    ingested: 0,
    contentIndexed: 0,
    errors: 0,
  };

  const { data } = await drive.files.list({
    pageSize: Math.min(max, 100),
    orderBy: "modifiedTime desc",
    fields:
      "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, owners(emailAddress), size, md5Checksum)",
    q: "trashed = false",
  });

  const files = data.files ?? [];
  summary.scanned = files.length;

  for (const f of files) {
    if (!f.id || !f.name || !f.mimeType) continue;
    try {
      // Bronze — idempotent on file id
      await db()
        .insert(bronzeDriveFiles)
        .values({
          fileId: f.id,
          rawPayload: f,
          mimeType: f.mimeType,
          sourceEtag: f.md5Checksum ?? null,
          sourceModifiedMs: f.modifiedTime
            ? new Date(f.modifiedTime).getTime()
            : Date.now(),
          fetchedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: bronzeDriveFiles.fileId,
          set: {
            rawPayload: f,
            mimeType: f.mimeType,
            sourceEtag: f.md5Checksum ?? null,
            sourceModifiedMs: f.modifiedTime
              ? new Date(f.modifiedTime).getTime()
              : Date.now(),
            fetchedAt: Date.now(),
          },
        });

      // Silver — structured row
      await db()
        .insert(driveFiles)
        .values({
          fileId: f.id,
          title: f.name,
          mimeType: f.mimeType,
          webViewLink: f.webViewLink ?? null,
          modifiedAt: f.modifiedTime
            ? new Date(f.modifiedTime).getTime()
            : Date.now(),
          ownerEmail: f.owners?.[0]?.emailAddress ?? null,
          sizeBytes: f.size ? Number(f.size) : null,
        })
        .onConflictDoUpdate({
          target: driveFiles.fileId,
          set: {
            title: f.name,
            mimeType: f.mimeType,
            webViewLink: f.webViewLink ?? null,
            modifiedAt: f.modifiedTime
              ? new Date(f.modifiedTime).getTime()
              : Date.now(),
            ownerEmail: f.owners?.[0]?.emailAddress ?? null,
            sizeBytes: f.size ? Number(f.size) : null,
            sourceVersion: sql`${driveFiles.sourceVersion} + 1`,
          },
        });

      summary.ingested++;

      if (TEXT_LIKE_MIMES.has(f.mimeType)) {
        const content = await fetchFileContent(drive, f.id, f.mimeType);
        if (content) {
          await indexFileContent(f.id, f.name, content);
          summary.contentIndexed++;
        } else {
          await indexFileContent(f.id, f.name, "");
        }
      } else {
        await indexFileContent(f.id, f.name, "");
      }
    } catch (err) {
      summary.errors++;
      await logEvent(
        "error",
        { fileId: f.id, message: (err as Error).message },
        INTEGRATION_ID,
      );
    }
  }

  // Sync state
  await db()
    .insert(syncState)
    .values({
      integrationId: INTEGRATION_ID,
      cursor: data.nextPageToken ?? null,
      lastRunAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: syncState.integrationId,
      set: {
        cursor: data.nextPageToken ?? null,
        lastRunAt: Date.now(),
      },
    });

  await logEvent("sync", summary, INTEGRATION_ID);
  return summary;
}

async function fetchFileContent(
  drive: ReturnType<typeof google.drive>,
  fileId: string,
  mimeType: string,
): Promise<string | null> {
  try {
    if (mimeType === "application/vnd.google-apps.document") {
      const res = await drive.files.export(
        { fileId, mimeType: "text/plain" },
        { responseType: "text" },
      );
      return typeof res.data === "string" ? res.data : null;
    }
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "text" },
    );
    return typeof res.data === "string" ? res.data : null;
  } catch {
    return null;
  }
}

const CHUNK_SIZE = 3200;

function chunkText(text: string, size = CHUNK_SIZE): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    const slice = text.slice(i, i + size).trim();
    if (slice.length > 20) chunks.push(slice);
  }
  return chunks;
}

async function indexFileContent(fileId: string, title: string, content: string) {
  // Replace all chunks for this file (re-derivable from bronze)
  await db().delete(driveFileChunks).where(eq(driveFileChunks.fileId, fileId));

  // Always insert at least one chunk containing the title so FTS can hit
  // on filename-only matches.
  const chunks = chunkText(content);
  const rows = chunks.length
    ? chunks.map((c, i) => ({
        fileId,
        position: i,
        text: `${title}\n\n${c}`,
      }))
    : [{ fileId, position: 0, text: title }];

  // Batch insert
  await db().insert(driveFileChunks).values(rows);
}

// ─── Read APIs (used by MCP server + agents) ────────────────────────

export type DriveFileRow = {
  file_id: string;
  title: string;
  mime_type: string;
  web_view_link: string | null;
  modified_at: number;
  owner_email: string | null;
};

export async function listRecentFiles(limit = 25): Promise<DriveFileRow[]> {
  const rows = await db()
    .select({
      file_id: driveFiles.fileId,
      title: driveFiles.title,
      mime_type: driveFiles.mimeType,
      web_view_link: driveFiles.webViewLink,
      modified_at: driveFiles.modifiedAt,
      owner_email: driveFiles.ownerEmail,
    })
    .from(driveFiles)
    .orderBy(desc(driveFiles.modifiedAt))
    .limit(limit);
  return rows as DriveFileRow[];
}

export async function getFile(
  fileId: string,
): Promise<(DriveFileRow & { content: string }) | null> {
  const fileRows = await db()
    .select({
      file_id: driveFiles.fileId,
      title: driveFiles.title,
      mime_type: driveFiles.mimeType,
      web_view_link: driveFiles.webViewLink,
      modified_at: driveFiles.modifiedAt,
      owner_email: driveFiles.ownerEmail,
    })
    .from(driveFiles)
    .where(eq(driveFiles.fileId, fileId));
  const row = fileRows[0];
  if (!row) return null;

  const chunkRows = await db()
    .select({ text: driveFileChunks.text })
    .from(driveFileChunks)
    .where(eq(driveFileChunks.fileId, fileId))
    .orderBy(driveFileChunks.position);

  return {
    ...(row as DriveFileRow),
    content: chunkRows.map((c) => c.text).join("\n\n"),
  };
}

export type SearchHit = {
  file_id: string;
  title: string;
  snippet: string;
  mime_type: string;
  web_view_link: string | null;
  modified_at: number;
  rank: number;
};

/**
 * Postgres full-text search using tsvector + ts_headline for snippet generation.
 * Drizzle doesn't model tsvector natively, so we drop to raw SQL here.
 */
export async function searchDrive(
  query: string,
  limit = 10,
): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const rows = await db().execute<{
    file_id: string;
    title: string;
    snippet: string;
    mime_type: string;
    web_view_link: string | null;
    modified_at: string;
    rank: number;
  }>(sql`
    with q as (select websearch_to_tsquery('english', ${query}) as tsq)
    select
      f.file_id                                          as file_id,
      f.title                                            as title,
      ts_headline(
        'english',
        c.text,
        q.tsq,
        'MaxWords=30, MinWords=10, ShortWord=3, HighlightAll=FALSE, StartSel=<<, StopSel=>>'
      )                                                  as snippet,
      f.mime_type                                        as mime_type,
      f.web_view_link                                    as web_view_link,
      f.modified_at::text                                as modified_at,
      ts_rank(c.text_search, q.tsq)                      as rank
    from drive_file_chunks c, q
    join drive_files f on f.file_id = c.file_id
    where c.text_search @@ q.tsq
    order by rank desc, f.modified_at desc
    limit ${limit}
  `);

  return (rows.rows ?? rows).map((r) => ({
    file_id: r.file_id,
    title: r.title,
    snippet: r.snippet,
    mime_type: r.mime_type,
    web_view_link: r.web_view_link,
    modified_at: Number(r.modified_at),
    rank: Number(r.rank),
  })) as SearchHit[];
}

export async function getSyncState() {
  const rows = await db()
    .select()
    .from(syncState)
    .where(eq(syncState.integrationId, INTEGRATION_ID));
  return rows[0];
}

export async function fileCount(): Promise<number> {
  const rows = await db().execute<{ c: string }>(
    sql`select count(*)::text as c from drive_files`,
  );
  const raw = (rows.rows ?? rows)[0];
  return Number(raw?.c ?? 0);
}

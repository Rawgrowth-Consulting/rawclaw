/**
 * Migration drift audit worker. Every tick (cron / rawclaw-tick.timer
 * at ~4h cadence) compares the supabase/migrations/*.sql files in
 * the deployed image against the rgaios_schema_migrations tracking
 * table in the live database. Any drift (file missing from DB or DB
 * row with no file) is reported.
 *
 * Why: scripts/apply-cloud-migrations.mjs only runs from a developer
 * box. If a deploy lands a new file but the migration apply step is
 * skipped (forgotten, failed, manual rollback), the runtime code
 * starts referencing schema that doesn't exist. This worker is the
 * detector + alerter.
 *
 * v1 output: writes one row to rgaios_audit_log with
 * kind='migration_audit'. The admin /audit page (separate ticket)
 * surfaces it; alerting hook is a stub for ops to wire later.
 *
 * DRY_RUN: env MIGRATION_AUDIT_DRY_RUN=1 skips the rgaios_audit_log
 * insert and only console.logs the drift. The cron supervisor flips
 * it off after ops eyeballs the first 3 reports.
 */

import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { supabaseAdmin } from "@/lib/supabase/server";

export type MigrationAuditReport = {
  fileCount: number;
  dbCount: number;
  missingInDb: string[];   // file exists in image, not applied to DB
  missingInImage: string[]; // DB row exists for a file no longer in the image
  drift: boolean;
  dryRun: boolean;
  detectedAt: string;
};

export type MigrationAuditDeps = {
  /**
   * Filesystem migration file lister. Default reads
   * supabase/migrations/ relative to cwd; the spec injects a stub
   * list so the test doesn't depend on the on-disk tree.
   */
  listFiles?: () => string[];
  /**
   * Loader for the rgaios_schema_migrations rows. Default hits
   * supabaseAdmin; the spec injects a stub list.
   */
  loadAppliedFilenames?: () => Promise<string[]>;
  /**
   * Audit-log writer. Default inserts to rgaios_audit_log via
   * supabaseAdmin; the spec captures the call.
   */
  recordAudit?: (report: MigrationAuditReport) => Promise<void>;
  /**
   * Override DRY_RUN env read (test injection).
   */
  dryRunOverride?: boolean;
};

const MIGRATIONS_DIR = "supabase/migrations";

function defaultListFiles(): string[] {
  return readdirSync(resolve(process.cwd(), MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function defaultLoadAppliedFilenames(): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_schema_migrations")
    .select("filename");
  if (error) throw new Error(`migration-audit: ${error.message}`);
  return (data ?? []).map((row) => (row as { filename: string }).filename);
}

async function defaultRecordAudit(report: MigrationAuditReport): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("rgaios_audit_log")
    .insert({
      kind: "migration_audit",
      actor_type: "system",
      actor_id: "migration-audit-worker",
      detail: report as unknown as Record<string, unknown>,
    } as never);
  if (error) {
    console.error("[migration-audit] audit insert failed", error);
  }
}

/**
 * Pure diff function. Takes two sorted string lists and produces
 * the drift report. Kept separate so the test can drive it with
 * synthetic input.
 */
export function diffMigrations(
  files: string[],
  applied: string[],
): Pick<MigrationAuditReport, "missingInDb" | "missingInImage" | "drift"> {
  const fileSet = new Set(files);
  const appliedSet = new Set(applied);
  const missingInDb = files.filter((f) => !appliedSet.has(f)).sort();
  const missingInImage = applied.filter((f) => !fileSet.has(f)).sort();
  return {
    missingInDb,
    missingInImage,
    drift: missingInDb.length > 0 || missingInImage.length > 0,
  };
}

export async function runMigrationAuditTick(
  deps: MigrationAuditDeps = {},
): Promise<MigrationAuditReport> {
  const files = (deps.listFiles ?? defaultListFiles)();
  const applied = await (deps.loadAppliedFilenames ?? defaultLoadAppliedFilenames)();
  const diff = diffMigrations(files, applied);
  const dryRun =
    deps.dryRunOverride ?? process.env.MIGRATION_AUDIT_DRY_RUN === "1";

  const report: MigrationAuditReport = {
    fileCount: files.length,
    dbCount: applied.length,
    missingInDb: diff.missingInDb,
    missingInImage: diff.missingInImage,
    drift: diff.drift,
    dryRun,
    detectedAt: new Date().toISOString(),
  };

  if (dryRun) {
    console.info("[migration-audit] DRY_RUN report", report);
  } else {
    await (deps.recordAudit ?? defaultRecordAudit)(report);
  }
  return report;
}

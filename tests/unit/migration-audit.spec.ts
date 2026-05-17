import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diffMigrations,
  runMigrationAuditTick,
  type MigrationAuditReport,
} from "../../src/workers/migration-audit";

test("diffMigrations: aligned sets = no drift", () => {
  const out = diffMigrations(["0001.sql", "0002.sql"], ["0001.sql", "0002.sql"]);
  assert.deepEqual(out, { missingInDb: [], missingInImage: [], drift: false });
});

test("diffMigrations: file ahead of DB = missingInDb", () => {
  const out = diffMigrations(["0001.sql", "0002.sql", "0003.sql"], ["0001.sql"]);
  assert.deepEqual(out.missingInDb, ["0002.sql", "0003.sql"]);
  assert.deepEqual(out.missingInImage, []);
  assert.equal(out.drift, true);
});

test("diffMigrations: DB ahead of file = missingInImage", () => {
  const out = diffMigrations(["0001.sql"], ["0001.sql", "0099.sql"]);
  assert.deepEqual(out.missingInDb, []);
  assert.deepEqual(out.missingInImage, ["0099.sql"]);
  assert.equal(out.drift, true);
});

test("diffMigrations: both sides drift", () => {
  const out = diffMigrations(
    ["0001.sql", "0002.sql"],
    ["0001.sql", "0099.sql"],
  );
  assert.deepEqual(out.missingInDb, ["0002.sql"]);
  assert.deepEqual(out.missingInImage, ["0099.sql"]);
  assert.equal(out.drift, true);
});

test("diffMigrations: sorted output deterministic", () => {
  const out = diffMigrations(
    ["0003.sql", "0001.sql", "0002.sql"],
    ["0001.sql"],
  );
  assert.deepEqual(out.missingInDb, ["0002.sql", "0003.sql"]);
});

test("runMigrationAuditTick: aligned = drift:false + counts match", async () => {
  const report = await runMigrationAuditTick({
    listFiles: () => ["a.sql", "b.sql"],
    loadAppliedFilenames: async () => ["a.sql", "b.sql"],
    dryRunOverride: true,
  });
  assert.equal(report.fileCount, 2);
  assert.equal(report.dbCount, 2);
  assert.equal(report.drift, false);
  assert.equal(report.dryRun, true);
});

test("runMigrationAuditTick: drift = drift:true + populated lists", async () => {
  const report = await runMigrationAuditTick({
    listFiles: () => ["a.sql", "b.sql", "c.sql"],
    loadAppliedFilenames: async () => ["a.sql"],
    dryRunOverride: true,
  });
  assert.equal(report.drift, true);
  assert.deepEqual(report.missingInDb, ["b.sql", "c.sql"]);
});

test("runMigrationAuditTick: DRY_RUN skips audit insert", async () => {
  let recorded = false;
  await runMigrationAuditTick({
    listFiles: () => ["a.sql"],
    loadAppliedFilenames: async () => ["a.sql"],
    recordAudit: async () => {
      recorded = true;
    },
    dryRunOverride: true,
  });
  assert.equal(recorded, false);
});

test("runMigrationAuditTick: live mode calls recordAudit with report", async () => {
  const captured: MigrationAuditReport[] = [];
  await runMigrationAuditTick({
    listFiles: () => ["a.sql", "b.sql"],
    loadAppliedFilenames: async () => ["a.sql"],
    recordAudit: async (r) => {
      captured.push(r);
    },
    dryRunOverride: false,
  });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].drift, true);
  assert.equal(captured[0].dryRun, false);
  assert.deepEqual(captured[0].missingInDb, ["b.sql"]);
});

test("runMigrationAuditTick: detectedAt is a parseable ISO timestamp", async () => {
  const report = await runMigrationAuditTick({
    listFiles: () => [],
    loadAppliedFilenames: async () => [],
    dryRunOverride: true,
  });
  assert.doesNotThrow(() => new Date(report.detectedAt).toISOString());
});

test("runMigrationAuditTick: empty filesystem + empty DB = no drift", async () => {
  const report = await runMigrationAuditTick({
    listFiles: () => [],
    loadAppliedFilenames: async () => [],
    dryRunOverride: true,
  });
  assert.equal(report.drift, false);
  assert.equal(report.fileCount, 0);
  assert.equal(report.dbCount, 0);
});

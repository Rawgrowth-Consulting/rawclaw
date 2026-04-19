#!/usr/bin/env node
/**
 * Applies the Drizzle schema to the Postgres DB pointed at by DATABASE_URL,
 * then runs src/lib/db/init.sql to add the tsvector column + GIN index
 * that Drizzle can't express.
 *
 * Run once after a fresh Neon DB is provisioned, or after schema changes.
 * Usage:  npm run db:push
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { execSync } from "node:child_process";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set");
  }

  console.log("→ drizzle-kit push (sync schema)…");
  execSync("npx drizzle-kit push --force", { stdio: "inherit" });

  console.log("→ applying init.sql (tsvector + indexes)…");
  const sqlText = readFileSync(
    path.resolve(process.cwd(), "src/lib/db/init.sql"),
    "utf8",
  );

  const sql = neon(process.env.DATABASE_URL);
  // Neon HTTP driver requires individual statements; split on ';'
  const statements = sqlText
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const stmt of statements) {
    await sql.query(stmt);
  }

  console.log("✓ DB ready.");
}

main().catch((err) => {
  console.error("db-push failed:", err);
  process.exit(1);
});

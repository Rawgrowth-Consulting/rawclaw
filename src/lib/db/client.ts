import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Neon Postgres via HTTP driver — designed for serverless (no connection pool,
 * one HTTPS request per query). Single shared client for all routes.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  // Only throw when actually used (not on module load) so build-time imports work
  // without the env var.
}

let _db: ReturnType<typeof drizzle> | null = null;

export function db() {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env locally or to your Vercel project.",
    );
  }
  const sql = neon(url);
  _db = drizzle(sql, { schema });
  return _db;
}

export { schema };

#!/usr/bin/env node
/**
 * Dev CLI to trigger a Drive sync without going through the web UI.
 * Useful for re-running sync after schema changes or to verify the
 * OAuth connection still works.
 *
 * Usage:
 *   npm run drive:sync         # syncs up to 100 most-recent files
 *   npm run drive:sync -- 250  # custom limit
 */

import "dotenv/config";
import { syncDrive } from "../src/lib/google/drive.js";

async function main() {
  const limit = Number(process.argv[2] ?? 100);
  console.log(`Syncing up to ${limit} files…`);
  const summary = await syncDrive({ maxFiles: limit });
  console.log("Done.", summary);
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});

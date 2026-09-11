// Applies drizzle/0067_goldline_chapter_states.sql and
// 0068_goldline_chapter_event_bindings.sql. These are deliberately gated
// behind DAYFORGE_RELEASE_DB=1 and kept out of scripts/migrate.mjs (see
// each file's own header comment) — this is a one-time, explicitly
// approved apply, not part of the always-on boot migration path.
//
// Plain .mjs (no TypeScript/tsx dependency) so it runs the same way in
// production as scripts/migrate.mjs already does. Both statements are
// CREATE TABLE IF NOT EXISTS, so this is safe to run more than once.

import mysql from "mysql2/promise";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

if (process.env.DAYFORGE_RELEASE_DB !== "1") {
  console.error("Refusing to run without DAYFORGE_RELEASE_DB=1");
  process.exit(1);
}

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL env var required");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationDir = resolve(__dirname, "..", "drizzle");
const files = [
  "0067_goldline_chapter_states.sql",
  "0068_goldline_chapter_event_bindings.sql",
];

const conn = await mysql.createConnection(DB_URL);
console.log("Connected to Railway MySQL");

for (const file of files) {
  const sql = await readFile(resolve(migrationDir, file), "utf8");
  await conn.query(sql);
  console.log(`✓ Applied ${file}`);
}

await conn.end();
console.log("\nChapter migrations complete.");

import mysql from "mysql2/promise";
import { readFile } from "node:fs/promises";

const databaseUrl =
  process.env.PRESIDENT_DATABASE_URL?.trim() ||
  process.env.DATABASE_URL?.trim();
if (!databaseUrl)
  throw new Error("PRESIDENT_DATABASE_URL or DATABASE_URL is required");
if (process.env.PRESIDENT_CYCLE_SCHEMA_MIGRATION_APPROVED !== "YES")
  throw new Error(
    "Set PRESIDENT_CYCLE_SCHEMA_MIGRATION_APPROVED=YES only for an explicitly authorized President cycle schema migration"
  );

const sql = await readFile(
  new URL("../drizzle/0120_president_autonomous_cycles.sql", import.meta.url),
  "utf8"
);
const statements = sql
  .replace(/^\s*--.*$/gm, "")
  .split(";")
  .map(value => value.trim())
  .filter(Boolean);

const connection = await mysql.createConnection(databaseUrl);
try {
  for (const statement of statements) await connection.execute(statement);
  console.log("✓ President autonomous cycle schema ready");
} finally {
  await connection.end();
}

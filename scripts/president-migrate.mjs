import mysql from "mysql2/promise";
import { readFile } from "node:fs/promises";

const databaseUrl = process.env.PRESIDENT_DATABASE_URL?.trim();
if (!databaseUrl)
  throw new Error("PRESIDENT_DATABASE_URL is required; President schema migration never falls back to DATABASE_URL");
if (process.env.PRESIDENT_SCHEMA_MIGRATION_APPROVED !== "YES")
  throw new Error("Set PRESIDENT_SCHEMA_MIGRATION_APPROVED=YES only for an explicitly authorized President schema migration");
if (
  process.env.DATABASE_URL &&
  databaseUrl === process.env.DATABASE_URL &&
  process.env.PRESIDENT_PRODUCTION_SCHEMA_APPROVED !== "YES"
)
  throw new Error(
    "President schema target matches DATABASE_URL; set PRESIDENT_PRODUCTION_SCHEMA_APPROVED=YES only after explicit production approval"
  );

const files = [
  "../drizzle/0109_president_stage1.sql",
  "../drizzle/0113_president_intelligence.sql",
  "../drizzle/0114_president_operating_system.sql",
];

const connection = await mysql.createConnection(databaseUrl);
try {
  for (const relativePath of files) {
    const sql = await readFile(new URL(relativePath, import.meta.url), "utf8");
    const statements = sql
      .replace(/^\s*--.*$/gm, "")
      .split(";")
      .map(value => value.trim())
      .filter(Boolean);
    for (const statement of statements) await connection.execute(statement);
    console.log("✓", relativePath);
  }
  console.log("President schema migration complete.");
} finally {
  await connection.end();
}

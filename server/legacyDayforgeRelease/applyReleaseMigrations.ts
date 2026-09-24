/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

export function legacyLegacyDayforgeReleaseMigrationFilenames(
  filenames: readonly string[],
  fromPrefix?: string
): string[] {
  const normalizedFrom = fromPrefix?.trim();
  return filenames
    .filter(filename => /^\d{4}_.+\.sql$/.test(filename))
    .filter(filename => !normalizedFrom || filename.slice(0, 4) >= normalizedFrom)
    .sort((left, right) => left.localeCompare(right));
}

export function normalizeLegacyDayforgeReleaseMigrationSql(sql: string): string {
  return sql.replace(
    /[ \t]*--> statement-breakpoint[ \t]*(?:\r?\n)?/g,
    "\n"
  );
}

export async function applyLegacyDayforgeReleaseMigrations(input: {
  databaseUrl: string;
  migrationDirectory?: string;
  fromPrefix?: string;
}): Promise<string[]> {
  if (process.env.DAYFORGE_RELEASE_DB !== "1") {
    throw new Error(
      "Refusing to apply release migrations without DAYFORGE_RELEASE_DB=1"
    );
  }
  const migrationDirectory =
    input.migrationDirectory ?? resolve(process.cwd(), "drizzle");
  const filenames = legacyLegacyDayforgeReleaseMigrationFilenames(
    await readdir(migrationDirectory),
    input.fromPrefix
  );
  if (filenames.length === 0) {
    throw new Error(
      `No release migrations found in ${migrationDirectory}` +
        (input.fromPrefix ? ` at or after ${input.fromPrefix}` : "")
    );
  }

  const connection = await mysql.createConnection({
    uri: input.databaseUrl,
    multipleStatements: true,
  });
  try {
    for (const filename of filenames) {
      const sql = normalizeLegacyDayforgeReleaseMigrationSql(
        await readFile(resolve(migrationDirectory, filename), "utf8")
      );
      await connection.query(sql);
      process.stdout.write(`Applied ${filename}\n`);
    }
  } finally {
    await connection.end();
  }
  return filenames;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const fromPrefix = process.env.DAYFORGE_RELEASE_FROM?.trim();
  await applyLegacyDayforgeReleaseMigrations({ databaseUrl, fromPrefix });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

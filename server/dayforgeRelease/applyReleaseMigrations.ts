import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

export function dayforgeReleaseMigrationFilenames(
  filenames: readonly string[]
): string[] {
  return filenames
    .filter(filename => /^\d{4}_.+\.sql$/.test(filename))
    .sort((left, right) => left.localeCompare(right));
}

export function normalizeDayforgeReleaseMigrationSql(sql: string): string {
  return sql.replace(
    /[ \t]*--> statement-breakpoint[ \t]*(?:\r?\n)?/g,
    "\n"
  );
}

export async function applyDayforgeReleaseMigrations(input: {
  databaseUrl: string;
  migrationDirectory?: string;
}): Promise<string[]> {
  if (process.env.DAYFORGE_RELEASE_DB !== "1") {
    throw new Error(
      "Refusing to apply release migrations without DAYFORGE_RELEASE_DB=1"
    );
  }
  const migrationDirectory =
    input.migrationDirectory ?? resolve(process.cwd(), "drizzle");
  const filenames = dayforgeReleaseMigrationFilenames(
    await readdir(migrationDirectory)
  );
  if (filenames.length === 0) {
    throw new Error(`No release migrations found in ${migrationDirectory}`);
  }

  const connection = await mysql.createConnection({
    uri: input.databaseUrl,
    multipleStatements: true,
  });
  try {
    for (const filename of filenames) {
      const sql = normalizeDayforgeReleaseMigrationSql(
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
  await applyDayforgeReleaseMigrations({ databaseUrl });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

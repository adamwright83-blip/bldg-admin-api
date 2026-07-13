import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dayforgeReleaseMigrationFilenames,
  normalizeDayforgeReleaseMigrationSql,
} from "./applyReleaseMigrations";

describe("DayForge release migration runner", () => {
  it("selects every root SQL migration in stable filename order", async () => {
    const migrationDirectory = resolve(process.cwd(), "drizzle");
    const filenames = dayforgeReleaseMigrationFilenames(
      await readdir(migrationDirectory)
    );
    expect(filenames[0]).toMatch(/^0000_/);
    expect(filenames).toContain("0043_dayforge_analytics_release.sql");
    expect(filenames).toEqual([...filenames].sort((a, b) => a.localeCompare(b)));
    expect(new Set(filenames).size).toBe(filenames.length);

    for (const filename of filenames) {
      const normalized = normalizeDayforgeReleaseMigrationSql(
        await readFile(resolve(migrationDirectory, filename), "utf8")
      );
      expect(normalized.trim(), `${filename} must not be empty`).not.toBe("");
      expect(normalized, `${filename} has an unhandled Drizzle breakpoint`).not.toContain(
        "--> statement-breakpoint"
      );
    }
  });

  it("removes Drizzle breakpoints without removing SQL statements", () => {
    expect(
      normalizeDayforgeReleaseMigrationSql(
        "CREATE TABLE one (id int);\n--> statement-breakpoint\nCREATE TABLE two (id int);"
      )
    ).toBe("CREATE TABLE one (id int);\n\nCREATE TABLE two (id int);");
  });
});

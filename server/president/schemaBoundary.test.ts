import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("President schema and truth boundaries", () => {
  it("ordinary production boot excludes President and keeps authority migrations", () => {
    const migration = readFileSync("scripts/migrate.mjs", "utf8");
    expect(migration).not.toMatch(/president_(evidence|programs|assessments)/);
    expect(migration).toContain("authority_receipts");
    expect(migration).toContain("operator_representative_directives");
  });
  it("explicit schema runner requires separate approval and DB target", () => {
    const migration = readFileSync("scripts/president-migrate.mjs", "utf8");
    expect(migration).toContain("PRESIDENT_SCHEMA_MIGRATION_APPROVED");
    expect(migration).toContain("PRESIDENT_PRODUCTION_SCHEMA_APPROVED");
    expect(migration).toContain("PRESIDENT_DATABASE_URL is required");
  });
});

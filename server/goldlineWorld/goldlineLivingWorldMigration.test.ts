import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "drizzle/0061_goldline_living_business_world.sql"), "utf8");

describe("Goldline living-world migration", () => {
  it("removes daily overwrite semantics and preserves raw historical transcript", () => {
    expect(sql).toContain("DROP INDEX `uq_driver_sales_journal_tenant_driver_date`");
    expect(sql).toContain("SET `rawTranscript` = `transcript`");
    expect(sql).not.toMatch(/DELETE FROM `driver_sales_journals`/i);
  });
  it("keeps role-neutral identity free of competing geography", () => {
    const table = sql.split("CREATE TABLE IF NOT EXISTS `physical_entities`")[1]!.split(");")[0]!;
    expect(table).not.toMatch(/latitude|longitude|address/i);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `goldline_world_events`");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `tower_asset_versions`");
  });
});

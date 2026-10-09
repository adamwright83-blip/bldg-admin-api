import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "drizzle/0062_goldline_territories.sql"),
  "utf8"
);

describe("Goldline territory migration", () => {
  it("is additive game-projection storage with no business rewrite", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `goldline_territory_definitions`");
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|UPDATE `/i);
    expect(sql).not.toMatch(/orders|customers|commercial_accounts|physical_entities`/i);
  });

  it("does not store coordinates or mutable progress counters", () => {
    expect(sql).not.toMatch(/latitude|longitude|completedCount|progressCount/i);
    expect(sql).toContain("`membersJson` json NOT NULL");
    expect(sql).toContain("`classification` varchar(32) NOT NULL DEFAULT 'game_projection'");
    expect(sql).toContain("UNIQUE KEY `uq_goldline_territory_stable`");
  });
});

describe("territory publish concurrency", () => {
  it("treats a duplicate stable-key insert as already published", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/goldlineWorld/territoryService.ts"),
      "utf8"
    );
    expect(source).toContain("isMysqlDuplicateKeyError");
    expect(source).toMatch(/stableKey === input\.candidate\.stableKey/);
  });
});

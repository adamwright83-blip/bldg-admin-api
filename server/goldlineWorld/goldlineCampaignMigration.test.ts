import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "drizzle/0063_goldline_campaigns.sql"),
  "utf8"
);

describe("Goldline campaign migration", () => {
  it("is additive game-projection storage with no business rewrite", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `goldline_campaign_instances`");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `goldline_campaign_revisions`");
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|UPDATE `/i);
    expect(sql).not.toMatch(/orders|customers|commercial_accounts|physical_entities`/i);
  });

  it("does not store coordinates or copied business status", () => {
    expect(sql).not.toMatch(/latitude|longitude|customerStatus|orderStatus/i);
    expect(sql).toContain("`classification` varchar(32) NOT NULL DEFAULT 'game_projection'");
    expect(sql).toContain("UNIQUE KEY `uq_goldline_campaign_day`");
    expect(sql).toContain("UNIQUE KEY `uq_goldline_campaign_revision`");
  });
});

describe("campaign publish concurrency", () => {
  it("treats a duplicate day insert as already published", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/goldlineWorld/campaignService.ts"),
      "utf8"
    );
    expect(source).toContain("isMysqlDuplicateKeyError");
    expect(source).toContain("readCampaign(instance)");
    expect(source).toContain("getOrMaterializeTodayCampaign");
    expect(source).not.toMatch(/Math\.random/);
  });

  it("does not duplicate FieldToday into campaign tables", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/goldlineWorld/campaignService.ts"),
      "utf8"
    );
    expect(source).toContain("goldlineObjectivesFromFieldToday");
    expect(source).toContain("compileGoldlineCampaign");
    expect(source).not.toContain("insert(orders)");
  });
});

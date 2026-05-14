import { describe, expect, it } from "vitest";
import { normalizePropertyTower } from "@shared/propertyTowers";
import { cleanCloudLegacyCustomers } from "./cleancloudLegacy";
import { parseCsv } from "./externalSystems/csvIngestion";
import { cleanCloudDailyOrdersSalesPlaybook } from "./externalSystems/playbooks";

describe("CleanCloud legacy customer import data", () => {
  it("normalizes contest addresses to property and tower", () => {
    expect(normalizePropertyTower("3545 Wilshire Boulevard")).toMatchObject({
      propertyGroup: "opus_la",
      towerKey: "opus_south_3545",
      buildingAddressCanonical: "3545 Wilshire Blvd",
    });
    expect(normalizePropertyTower("3650 West 6th Street")).toMatchObject({
      propertyGroup: "opus_la",
      towerKey: "opus_north_3650",
      buildingAddressCanonical: "3650 W 6th Street",
    });
    expect(normalizePropertyTower("2170 Century Park East")).toMatchObject({
      propertyGroup: "century_park_east",
      towerKey: "cpe_south_2170",
      buildingAddressCanonical: "2170 Century Pk E",
    });
    expect(normalizePropertyTower("2160 Century Park East")).toMatchObject({
      propertyGroup: "century_park_east",
      towerKey: "cpe_north_2160",
      buildingAddressCanonical: "2160 Century Pk E",
    });
  });

  it("matches expected legacy revenue totals by property and tower", () => {
    const sum = (rows: typeof cleanCloudLegacyCustomers) =>
      Math.round(rows.reduce((total, row) => total + row.totalSpend, 0) * 100) / 100;

    expect(sum(cleanCloudLegacyCustomers)).toBe(735.93);
    expect(sum(cleanCloudLegacyCustomers.filter((row) => row.propertyGroup === "opus_la"))).toBe(630.08);
    expect(sum(cleanCloudLegacyCustomers.filter((row) => row.propertyGroup === "century_park_east"))).toBe(105.85);
    expect(sum(cleanCloudLegacyCustomers.filter((row) => row.towerKey === "opus_south_3545"))).toBe(415.83);
    expect(sum(cleanCloudLegacyCustomers.filter((row) => row.towerKey === "opus_north_3650"))).toBe(184.5);
    expect(sum(cleanCloudLegacyCustomers.filter((row) => row.propertyGroup === "opus_la" && row.towerKey === "unknown"))).toBe(29.75);
    expect(sum(cleanCloudLegacyCustomers.filter((row) => row.towerKey === "cpe_south_2170"))).toBe(20.75);
    expect(sum(cleanCloudLegacyCustomers.filter((row) => row.towerKey === "cpe_north_2160"))).toBe(85.1);
  });

  it("parses CSV values with quoted commas for stable ingestion", () => {
    const rows = parseCsv('Order ID,Customer Name,Total\n"1001","Lee, Abe","$94.05"\n');
    expect(rows).toEqual([
      {
        "Order ID": "1001",
        "Customer Name": "Lee, Abe",
        Total: "$94.05",
      },
    ]);
  });

  it("keeps browser automation as a CSV handoff playbook", () => {
    expect(cleanCloudDailyOrdersSalesPlaybook).toMatchObject({
      system: "cleancloud",
      downloadArtifact: "csv",
      handoffEndpoint: "/api/admin/cleancloud/import",
    });
    expect(cleanCloudDailyOrdersSalesPlaybook.steps.some((step) => step.instruction.includes("Do not write directly"))).toBe(true);
  });
});

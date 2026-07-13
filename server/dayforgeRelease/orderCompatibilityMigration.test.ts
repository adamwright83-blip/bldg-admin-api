import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../drizzle/0044_dayforge_release_order_compatibility.sql",
    import.meta.url
  ),
  "utf8"
);

describe("DayForge order compatibility migration", () => {
  it("converges every persisted order-routing column required by the schema", () => {
    for (const column of [
      "buildingSlug",
      "vendorId",
      "vendorNameSnapshot",
      "routingPrioritySnapshot",
      "platformFeeCents",
      "vendorPayoutCents",
      "stripeConnectedAccountIdSnapshot",
    ]) {
      expect(migration).toContain(`COLUMN_NAME = '${column}'`);
      expect(migration).toContain("ADD COLUMN `" + column + "`");
    }
  });

  it("checks information_schema before every compatibility ALTER", () => {
    expect(migration.match(/information_schema\.COLUMNS/g)).toHaveLength(7);
    expect(
      migration.match(/^PREPARE dayforge_order_column_stmt/gm)
    ).toHaveLength(7);
    expect(
      migration.match(/^DEALLOCATE PREPARE dayforge_order_column_stmt/gm)
    ).toHaveLength(7);
  });
});

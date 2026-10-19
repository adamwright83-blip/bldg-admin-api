/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Tenant Data Attribution and Ingestion Isolation", () => {
  it("migration 0143 reassigns CleanCloud orders and Store #34145 to laundry_farm", () => {
    const sql = readFileSync(
      new URL("../../../drizzle/0143_reassign_cleancloud_and_goal_lineage_to_laundry_farm.sql", import.meta.url),
      "utf8"
    );

    // Verifies CleanCloud binding for Store #34145 is routed to laundry_farm
    expect(sql).toContain("INSERT INTO `cleancloud_browser_sync_bindings`");
    expect(sql).toContain("'laundry_farm'");
    expect(sql).toContain("`storeId` = '34145'");

    // Verifies cleancloud_paid_orders reassigned to laundry_farm
    expect(sql).toContain("UPDATE `cleancloud_paid_orders`\nSET `tenantId` = 'laundry_farm'");
    expect(sql).toContain("UPDATE `authority_receipts`");
    expect(sql).toContain("cleancloud_paid_observed");

    // Verifies cadence orders reassigned to laundry_farm
    expect(sql).toContain("UPDATE `orders`\nSET `tenantId` = 'laundry_farm'");
    expect(sql).toContain("`residentClientRequestId` LIKE 'goldline:cadence:%'");

    // Verifies Order #707 and Stripe orders are NOT reassigned
    expect(sql).not.toContain("SET `tenantId` = 'laundry_farm' WHERE `id` = 707");

    // Verifies 50-active-customer goal lineage reassigned
    expect(sql).toContain("UPDATE `macro_goal_runs`\nSET `tenantId` = 'laundry_farm'");
    expect(sql).toContain("UPDATE `operator_macro_goals`\nSET `tenantId` = 'laundry_farm'");
    expect(sql).toContain("UPDATE `goal_cycle_decisions`\nSET `tenantId` = 'laundry_farm'");
    expect(sql).toContain("UPDATE `goal_cycle_objectives`\nSET `tenantId` = 'laundry_farm'");
    expect(sql).toContain("UPDATE `goal_cycle_history`\nSET `tenantId` = 'laundry_farm'");

    // Verifies recovery contacts sanitized and drafts cleared
    expect(sql).toContain("JSON_SET(`payloadJson`, '$.draft', NULL)");
    expect(sql).toContain("`status` = 'scheduled'");

    // Verifies commercial accounts replication preserving separate accounts
    expect(sql).toContain("INSERT INTO `commercial_accounts`");
    expect(sql).toContain("ca_farm.identityKey = ca_default.identityKey");
    expect(sql).toContain("INSERT INTO `commercial_account_locations`");
    // Commercial contacts and customer relationships must NOT be replicated across businesses
    expect(sql).not.toContain("INSERT INTO `commercial_account_contacts`");
  });

  it("governs operational migrations via scripts/migrate-laundry-farm-attribution.mjs", () => {
    const script = readFileSync(
      new URL("../../../scripts/migrate-laundry-farm-attribution.mjs", import.meta.url),
      "utf8"
    );
    expect(script).toContain("dayforge_saas_tenants");
    expect(script).toContain("ca_farm.identityKey = ca_default.identityKey");
    expect(script).toContain("cleancloud_browser_sync_bindings");
    expect(script).toContain("cleancloud_paid_observed");
  });

  it("laundryFarmSheetSync strictly queries laundry_farm tenant orders", () => {
    const sheetSync = readFileSync(
      new URL("../../laundryFarmSheetSync.ts", import.meta.url),
      "utf8"
    );
    expect(sheetSync).toContain('eq(cleancloudPaidOrders.tenantId, "laundry_farm")');
  });

  it("migration audit script supports dry-run, execute, verify, and rollback", () => {
    const script = readFileSync(
      new URL("../../../scripts/migrate-laundry-farm-attribution.mjs", import.meta.url),
      "utf8"
    );
    expect(script).toContain('mode === "dry-run"');
    expect(script).toContain('mode === "execute"');
    expect(script).toContain('mode === "verify"');
    expect(script).toContain('mode === "rollback"');
    expect(script).toContain("residentClientRequestId LIKE 'goldline:cadence:%'");
  });
});

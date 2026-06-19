import { describe, expect, it } from "vitest";
import { loadProcurementMigrations } from "./migrations";

describe("procurement migration files", () => {
  it("loads ordered procurement migrations with verification queries", async () => {
    const migrations = await loadProcurementMigrations();
    expect(migrations.map(migration => migration.key)).toEqual([
      "0000_held_schema_migrations.sql",
      "0001_procurement_workflow_foundation.sql",
      "0002_authority_grants.sql",
      "0003_guest_readiness_plans.sql",
      "0004_provider_acceptance_foundation.sql",
      "0005_marketplace_payments_foundation.sql",
    ]);
    for (const migration of migrations) {
      expect(migration.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(migration.statements.length).toBeGreaterThan(0);
      expect(migration.verificationStatements.length).toBeGreaterThan(0);
    }
  });
});

/* LEGACY DAYFORGE COMPATIBILITY: this test intentionally verifies the retained legacy entitlement boundary; canonical product is JOYSTICK. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function repoFile(relativePath: string): string {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), "utf8");
}

describe("Persistent Growth Operator Phase 0 schema contract", () => {
  it("lands Armory lineage and learning governance through all three migration paths", () => {
    const sql = repoFile("drizzle/0101_persistent_growth_phase0.sql");
    const schema = repoFile("drizzle/schema.ts");
    const migrate = repoFile("scripts/migrate.mjs");

    for (const source of [sql, schema, migrate]) {
      expect(source).toContain("decisionPointId");
      expect(source).toContain("encounterReference");
      expect(source).toContain("associationStrength");
      expect(source).toContain("mission_window_legacy");
      expect(source).toContain("tenant_learning_governance");
      expect(source).toContain("permittedAggregationUse");
      expect(source).toContain("authorizedByUserId");
    }
  });

  it("keeps the persistent-operator entitlement opt-in rather than a legacy default", () => {
    const tenant = repoFile("shared/saasTenant.ts");
    const store = repoFile("server/saas/saasStore.ts");

    expect(tenant).toContain('PERSISTENT_OPERATOR_ENTITLEMENT = "persistent_operator"');
    expect(store).toContain(
      "const values = requested.length > 0 ? requested : [...DAYFORGE_ENTITLEMENTS]"
    );
    expect(store).toContain("for (const entitlementKey of SAAS_ENTITLEMENTS)");
  });
});

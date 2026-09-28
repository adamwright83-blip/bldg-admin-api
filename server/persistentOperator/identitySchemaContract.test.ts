import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function repoFile(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("Persistent operator PR1 schema contract", () => {
  it("mirrors identity bindings and diagnostics across schema and both migration paths", () => {
    const sql = repoFile(
      "drizzle/0102_persistent_operator_identity_observability.sql"
    );
    const schema = repoFile("drizzle/schema.ts");
    const migrate = repoFile("scripts/migrate.mjs");

    for (const source of [sql, schema, migrate]) {
      expect(source).toContain("persistent_operator_identity_bindings");
      expect(source).toContain("canonicalOpenId");
      expect(source).toContain("aliasOpenId");
      expect(source).toContain("activeAliasKey");
      expect(source).toContain("uq_persistent_operator_identity_active_alias");
      expect(source).toContain("idx_persistent_operator_identity_alias");
      expect(source).toContain("idx_persistent_operator_identity_canonical");
      expect(source).toContain("persistent_operator_diagnostic_events");
      expect(source).toContain("canonicalOperatorId");
      expect(source).toContain("sourceIdentityType");
      expect(source).toContain("targetIdentityType");
      expect(source).toContain("idx_persistent_operator_diag_operator_time");
      expect(source).toContain("idx_persistent_operator_diag_reason");
    }
  });

  it("does not reintroduce a default-tenant fallback at migrated identity seams", () => {
    const files = [
      "server/persistentOperator/identity.ts",
      "server/persistentOperator/tenantScope.ts",
      "server/dayDirector/dayDirectorRouter.ts",
      "server/missionDirector/missionDirectorRouter.ts",
      "server/goldline/dayline/currentDayLineRouter.ts",
      "server/claire/weeklyMission/weeklyMissionRouter.ts",
      "server/campaignRuns/campaignRunRouter.ts",
      "server/lanternCity/lanternCityRouter.ts",
    ];
    for (const file of files) {
      expect(repoFile(file)).not.toMatch(/tenantId\s*:\s*[^\n]*\?\?\s*["']default["']/);
    }
  });
});

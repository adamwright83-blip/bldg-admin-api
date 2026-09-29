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

  it("serializes alias graph checks and inserts under locked persisted users", () => {
    const identity = repoFile("server/persistentOperator/identity.ts");
    expect(identity).toContain("db.transaction");
    expect(identity).toContain('.for("update")');
    expect(identity).toContain("inArray(users.id, [canonicalUser.id, aliasUser.id])");
    expect(identity).toMatch(/canonicalAsAlias[\s\S]*aliasAsCanonical/);
    expect(identity).toMatch(/tx\.insert\(persistentOperatorIdentityBindings\)/);
  });

  it("records Day Director verification only on the first real completion", () => {
    const router = repoFile("server/dayDirector/dayDirectorRouter.ts");
    expect(router).toMatch(/const result = await completeDayDirectorCommitment/);
    expect(router).toMatch(
      /if \(!result\.alreadyCompleted\)[\s\S]*eventKind: "objective_verified"[\s\S]*objectiveId: input\.commitmentId/
    );
  });

  it("records Day Director creation only when accept inserted a new commitment", () => {
    const router = repoFile("server/dayDirector/dayDirectorRouter.ts");
    const service = repoFile("server/dayDirector/dayDirectorService.ts");
    expect(router).toMatch(
      /const \{ stored, created \} = await acceptProposalWithReceipt/
    );
    expect(router).toMatch(
      /if \(stored && created\)[\s\S]*eventKind: "objective_created"[\s\S]*objectiveId: stored\.id/
    );
    expect(service).toContain(
      "created: Boolean(stored && stored.id === row.id)"
    );
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

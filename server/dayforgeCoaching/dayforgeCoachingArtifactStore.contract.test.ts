import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const storePath = new URL("./dayforgeCoachingArtifactStore.ts", import.meta.url);
const store = readFileSync(storePath, "utf8");
const schema = readFileSync(new URL("../../drizzle/schema.ts", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../drizzle/0045_dayforge_30_day_foundation.sql", import.meta.url),
  "utf8",
);

describe("DayForge coaching artifact persistence contract", () => {
  it("scopes every ownership lookup to the tenant and validates mission, account, and step", () => {
    expect(store).toContain("eq(commercialMissions.tenantId, input.tenantId)");
    expect(store).toContain("eq(commercialOpportunities.tenantId, input.tenantId)");
    expect(store).toContain("opportunity.accountId !== input.accountId");
    expect(store).toContain("eq(commercialAccounts.tenantId, input.tenantId)");
    expect(store).toContain("eq(commercialMissionSteps.tenantId, input.tenantId)");
    expect(store).toContain("eq(commercialMissionSteps.missionId, input.missionId)");
  });

  it("serializes stable versions on the mission and transactionally supersedes active history", () => {
    expect(store).toContain('.for("update")');
    expect(store).toContain("const version = (history[0]?.version ?? 0) + 1");
    expect(store).toContain(".set({ active: false, supersededAt: persistedAt })");
    expect(store).toContain("eq(commercialMissionCoachingArtifacts.active, true)");
    expect(store).toContain("active: true");
    expect(store).toContain("db.transaction(tx => persistWith(tx, validatedInput))");
    expect(store.indexOf("await assertMissionAccountScopeWith(tx, input)")).toBeLessThan(
      store.indexOf("const replay = await findByRequestWith(tx, input)"),
    );
  });

  it("replays tenant-scoped request IDs and stores structured results without prompts", () => {
    expect(store).toContain("eq(commercialMissionCoachingArtifacts.requestId, input.requestId)");
    expect(store).toContain("assertReplayMatches(replay, input)");
    expect(store).toContain("structuredOutputJson: input.structuredOutput");
    expect(store).toContain("evidenceReferencesJson: input.evidenceReferences");
    expect(store).toContain("claimsJson: input.structuredOutput.claims");
    expect(store).not.toMatch(/rawPrompt|chainOfThought|providerResponseBody/);
  });

  it("uses a stable active-content cache without caching provider fallback failures", () => {
    expect(store).toContain("dayforgeCoachingArtifactCacheKey(input)");
    expect(store).toContain('eq(commercialMissionCoachingArtifacts.generationStatus, "generated")');
    expect(store).toContain("eq(commercialMissionCoachingArtifacts.active, true)");
    expect(store).not.toMatch(/cacheKeyFor\([^)]*version/);
    expect(schema).toContain('index("idx_commercial_coaching_tenant_cache_key")');
    expect(migration).toContain(
      'INDEX `idx_commercial_coaching_tenant_cache_key` (`tenantId`,`cacheKey`)',
    );
    expect(migration).not.toContain("uq_commercial_coaching_tenant_cache_key");
  });
});

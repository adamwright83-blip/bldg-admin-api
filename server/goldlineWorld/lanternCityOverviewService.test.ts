import { describe, expect, it } from "vitest";
import {
  projectLanternCityOverview,
  resolveChapterLanternTerritory,
} from "./lanternCityOverviewService";
import {
  territoryCenter,
  territoryByName,
} from "../../shared/lanternTerritories";

function customer(
  name: string,
  state: "active" | "dimming" | "dark",
  days: number,
  firstOrderAt = "2026-01-01T12:00:00.000Z"
) {
  const point = territoryCenter(territoryByName("Silver Lake")!);
  return {
    identityKey: name.toLowerCase(),
    displayName: name,
    phone: "5550000000",
    address: "100 Real St",
    unit: null,
    cadence: {
      state,
      confidence: "measured",
      expectedCadenceDays: 7,
      daysSinceLastOrder: days,
      expectedNextOrder: null,
      cyclesMissed: 2,
    },
    totalOrders: 4,
    firstOrderAt,
    lastOrderAt: "2026-07-01T12:00:00.000Z",
    location: {
      ...point,
      x: 50,
      y: 50,
      outOfBounds: false,
      canonicalAddress: "100 Real St",
    },
    geocodeStatus: "success",
  };
}
function fixture(
  customers = [customer("Rebecca", "dark", 70), customer("Anita", "active", 3)]
) {
  return projectLanternCityOverview({
    atlas: {
      tenantId: "tenant",
      businessDate: "2026-09-08",
      timeZone: "America/Los_Angeles",
      provider: {
        status: "unconfigured",
        variable: "GOOGLE_ADDRESS_VALIDATION_API_KEY",
      },
      statusCounts: {},
      lastRunAt: null,
      customers,
      pursued: [],
    } as any,
    paidRevenueThisWeek: 1250,
    campaign: {
      campaign: { chapters: [], currentChapterId: null },
      pacing: "quiet",
    } as any,
  });
}

describe("Lantern City truthful overview", () => {
  it("uses exact real people and never invents a future person", () => {
    const result = fixture();
    expect(result.featuredOperation.knownLightIdentityKey).toBe("rebecca");
    expect(result.featuredOperation.objectives[0]?.label).toBe(
      "RELIGHT REBECCA"
    );
    expect(result.featuredOperation.secondLight?.personIdentity).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(
      /Marcus Vega|Elena|Roger|Field Intel|Impact|73%/i
    );
  });
  it("keeps scoreboard and district counts grounded in atlas customers", () => {
    const result = fixture();
    expect(result.scoreboard.customers).toBe(2);
    expect(result.scoreboard.dormant).toEqual({ numerator: 1, denominator: 2 });
    expect(result.scoreboard.districtsLit).toMatchObject({
      numerator: 1,
      denominator: 14,
    });
    expect(result.scoreboard.paidRevenueThisWeek).toBe(1250);
  });
  it("is deterministic and lets a fixed chapter preempt recovery drama", () => {
    const base = fixture();
    expect(fixture().featuredOperation.id).toBe(base.featuredOperation.id);
    const result = projectLanternCityOverview({
      atlas: {
        tenantId: "tenant",
        businessDate: "2026-09-08",
        timeZone: "America/Los_Angeles",
        customers: [customer("Rebecca", "dark", 70)],
        pursued: [],
      } as any,
      paidRevenueThisWeek: 0,
      campaign: {
        campaign: {
          currentChapterId: "fixed",
          chapters: [
            {
              stableChapterId: "fixed",
              territoryId: "d4d55c69-85cb-4b88-9db1-40972dcab441",
              required: true,
              hardAnchor: true,
              fictionalTreatment: "MAKE THE PICKUP",
              selectedGameplayBinding: "authoritative_visit_route",
            },
          ],
        },
      } as any,
      resolvedCampaignTerritory: {
        campaignTerritoryDefinitionId: "d4d55c69-85cb-4b88-9db1-40972dcab441",
        lanternCityTerritoryId: "silver-lake",
      },
    });
    expect(result.featuredOperation.id).toBe("fixed");
    expect(result.featuredOperation.isFixedCommitment).toBe(true);
    expect(result.featuredOperation.host).toBe("authoritative_visit_route");
  });
  it("does not count the Second Light as a customer", () => {
    const result = fixture();
    expect(result.scoreboard.customers).toBe(2);
    expect(
      result.territoryDossiers.find(item => item.territoryId === "silver-lake")
        ?.counts.total
    ).toBe(2);
  });
  it("resolves the Second Light only from a genuinely new real customer", () => {
    const result = projectLanternCityOverview({
      atlas: {
        tenantId: "tenant",
        businessDate: "2026-09-08",
        timeZone: "America/Los_Angeles",
        customers: [
          customer("Existing", "active", 2, "2026-01-01T00:00:00.000Z"),
          customer(
            "New Real Customer",
            "active",
            1,
            "2026-09-02T00:00:00.000Z"
          ),
        ],
        pursued: [],
      } as any,
      operation: {
        id: "operation-1",
        stableKey: "quiet-recovery",
        sourceCampaignChapterId: null,
        operationType: "recovery",
        campaignTerritoryDefinitionId: null,
        lanternCityTerritoryId: "silver-lake",
        startedAt: "2026-09-01T12:00:00.000Z",
        baselineCustomerIdentityKeys: ["existing"],
        baselineDormantIdentityKeys: [],
        anchorCustomerIdentityKey: null,
      },
      paidRevenueThisWeek: 0,
      campaign: {
        campaign: {
          currentChapterId: "chapter",
          startedAt: "2026-09-01T00:00:00.000Z",
          chapters: [
            {
              stableChapterId: "chapter",
              territoryId: "silver-lake",
              required: false,
              hardAnchor: false,
              fictionalTreatment: "",
              selectedGameplayBinding: "recovery",
            },
          ],
        },
      } as any,
    });
    expect(result.featuredOperation.secondLight).toMatchObject({
      status: "completed_by_real_customer",
      completedCustomerIdentityKey: "new real customer",
      personIdentity: null,
    });
    expect(result.scoreboard.customers).toBe(2);
  });

  it("resolves a persisted territory-definition UUID through real geography", () => {
    const chapter = {
      territoryId: "d4d55c69-85cb-4b88-9db1-40972dcab441",
      physicalAnchors: [],
    } as any;
    expect(
      resolveChapterLanternTerritory(chapter, [
        { id: chapter.territoryId, realGeographyLabel: "Silver Lake" },
      ])
    ).toEqual({
      campaignTerritoryDefinitionId: chapter.territoryId,
      lanternCityTerritoryId: "silver-lake",
    });
  });

  it("keeps an unbound fixed commitment geographically neutral despite recovery elsewhere", () => {
    const result = projectLanternCityOverview({
      atlas: {
        tenantId: "tenant",
        businessDate: "2026-09-08",
        timeZone: "America/Los_Angeles",
        customers: [customer("Elsewhere", "dark", 90)],
        pursued: [],
      } as any,
      paidRevenueThisWeek: 0,
      campaign: {
        campaign: {
          currentChapterId: "fixed",
          chapters: [
            {
              stableChapterId: "fixed",
              territoryId: null,
              physicalAnchors: [],
              required: true,
              hardAnchor: true,
              fictionalTreatment: "MAKE THE PICKUP",
              selectedGameplayBinding: "authoritative_visit_route",
            },
          ],
        },
      } as any,
      resolvedCampaignTerritory: {
        campaignTerritoryDefinitionId: null,
        lanternCityTerritoryId: null,
      },
    });
    expect(result.featuredOperation.territoryId).toBeNull();
    expect(result.featuredOperation.secondLight).toBeNull();
    expect(result.featuredOperation.objectives).toHaveLength(1);
  });

  it("allows a real fixed physical anchor to classify into Silver Lake", () => {
    const point = territoryCenter(territoryByName("Silver Lake")!);
    const resolved = resolveChapterLanternTerritory(
      { territoryId: null, physicalAnchors: [point] } as any,
      []
    );
    expect(resolved.lanternCityTerritoryId).toBe("silver-lake");
  });

  it("holds the baseline cohort and named anchor after A recovers while B stays dark", () => {
    const a = customer("A", "active", 1) as any;
    a.lastOrderAt = "2026-09-07T12:00:00.000Z";
    const result = projectLanternCityOverview({
      atlas: {
        tenantId: "tenant",
        businessDate: "2026-09-08",
        timeZone: "America/Los_Angeles",
        customers: [a, customer("B", "dark", 80)],
        pursued: [],
      } as any,
      paidRevenueThisWeek: 0,
      campaign: { campaign: { chapters: [], currentChapterId: null } } as any,
      operation: {
        id: "op",
        stableKey: "op",
        sourceCampaignChapterId: null,
        operationType: "recovery",
        campaignTerritoryDefinitionId: null,
        lanternCityTerritoryId: "silver-lake",
        startedAt: "2026-09-01T00:00:00.000Z",
        baselineCustomerIdentityKeys: ["a", "b"],
        baselineDormantIdentityKeys: ["a", "b"],
        anchorCustomerIdentityKey: "a",
      },
    });
    expect(result.featuredOperation.objectives[0]).toMatchObject({
      label: "RELIGHT A",
      current: 1,
      target: 1,
    });
    expect(result.featuredOperation.objectives[1]).toMatchObject({
      current: 1,
      target: 2,
    });
    expect(result.featuredOperation.knownLightIdentityKey).toBe("a");
  });
});

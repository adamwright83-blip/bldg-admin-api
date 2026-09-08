import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  projectLanternCityOverview,
  resolveChapterLanternTerritory,
} from "./lanternCityOverviewService";
import {
  LANTERN_TERRITORIES,
  territoryCenter,
  territoryByName,
} from "../../shared/lanternTerritories";
import { forecastTerritoryDecay } from "../../shared/lanternDecayForecast";

vi.mock("../../shared/lanternDecayForecast", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../shared/lanternDecayForecast")>();
  return {
    ...actual,
    forecastTerritoryDecay: vi.fn(actual.forecastTerritoryDecay),
  };
});

function customer(
  name: string,
  state: "active" | "dimming" | "dark",
  days: number,
  firstOrderAt = "2026-01-01T12:00:00.000Z",
  canonicalAddress = "100 Real St"
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
      canonicalAddress,
    },
    geocodeStatus: "success",
  };
}
function fixture(
  customers = [customer("Rebecca", "dark", 70), customer("Anita", "active", 3)],
  territoryStates?: Parameters<
    typeof projectLanternCityOverview
  >[0]["territoryStates"]
) {
  return projectLanternCityOverview({
    territoryStates,
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

function forecastOccupancy(territoryId: string) {
  const call = vi
    .mocked(forecastTerritoryDecay)
    .mock.calls.map(([input]) => input)
    .find(input => input.territoryId === territoryId);
  expect(call).toBeDefined();
  return call!.occupancy;
}

describe("Lantern City truthful overview", () => {
  beforeEach(() => {
    vi.mocked(forecastTerritoryDecay).mockClear();
  });

  it("hands the decay forecast the territory's real occupancy, never assumed flags", () => {
    const artsDistrict = LANTERN_TERRITORIES.find(t => t.id === "arts-district")!;
    expect(artsDistrict.initialState).toBe("guarded");

    fixture();
    // Silver Lake is held ground by its seed state and occupied, so never
    // guarded; unreached Arts District is guarded by its seed state. Same
    // derivation the scene uses.
    expect(forecastOccupancy("silver-lake")).toEqual({
      guarded: false,
      conquered: true,
      pressureReturned: false,
    });
    expect(forecastOccupancy("arts-district")).toEqual({
      guarded: true,
      conquered: false,
      pressureReturned: false,
    });

    vi.mocked(forecastTerritoryDecay).mockClear();
    fixture(undefined, [
      {
        definition: { realGeographyLabel: "Silver Lake" },
        state: { cleared: true, pressureReturned: true },
      },
      {
        definition: { realGeographyLabel: artsDistrict.name },
        state: { cleared: true, pressureReturned: false },
      },
    ]);
    // Real cleared history: pressure returned in Silver Lake, Arts District held.
    expect(forecastOccupancy("silver-lake")).toEqual({
      guarded: false,
      conquered: true,
      pressureReturned: true,
    });
    expect(forecastOccupancy("arts-district")).toEqual({
      guarded: false,
      conquered: true,
      pressureReturned: false,
    });
  });

  it("renders a cadence forecast only when measured cadence supports one", () => {
    const measured = fixture([customer("Anita", "active", 8)]);
    expect(
      measured.territoryDossiers.find(d => d.territoryId === "silver-lake")
        ?.decayForecast
    ).toMatch(/^Goes quiet in \d+ days? unless one order lands\.$/);

    const sparseCustomer = customer("Anita", "active", 8) as any;
    sparseCustomer.cadence.confidence = "sparse";
    sparseCustomer.cadence.expectedCadenceDays = null;
    const sparse = fixture([sparseCustomer]);
    expect(
      sparse.territoryDossiers.find(d => d.territoryId === "silver-lake")
        ?.decayForecast
    ).toBeNull();
  });
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

  describe("replace as rescue", () => {
    const operation = {
      id: "op",
      stableKey: "op",
      sourceCampaignChapterId: null,
      operationType: "recovery" as const,
      campaignTerritoryDefinitionId: null,
      lanternCityTerritoryId: "silver-lake",
      startedAt: "2026-09-01T00:00:00.000Z",
      baselineCustomerIdentityKeys: ["rebecca", "anita"],
      baselineDormantIdentityKeys: ["rebecca"],
      anchorCustomerIdentityKey: "rebecca",
    };
    function run(customers: ReturnType<typeof customer>[]) {
      return projectLanternCityOverview({
        atlas: {
          tenantId: "tenant",
          businessDate: "2026-09-08",
          timeZone: "America/Los_Angeles",
          customers,
          pursued: [],
        } as any,
        paidRevenueThisWeek: 0,
        campaign: { campaign: { chapters: [], currentChapterId: null } } as any,
        operation,
      });
    }
    const restore = (r: ReturnType<typeof run>) =>
      r.featuredOperation.objectives.find(o => o.id === "restore:silver-lake");

    it("counts a new resident's first order in a dark lantern's building toward RESTORE DORMANT LIGHTS", () => {
      const result = run([
        customer("Rebecca", "dark", 70),
        customer("Anita", "active", 3),
        customer("Noor", "active", 2, "2026-09-05T12:00:00.000Z"),
      ]);
      expect(restore(result)).toMatchObject({ current: 1, target: 1 });
      expect(result.featuredOperation.replacementRescues).toEqual([
        { dormantIdentityKey: "rebecca", newResidentIdentityKey: "noor" },
      ]);
      // The dark lantern itself has not returned; the rescue is the building's.
      expect(result.featuredOperation.objectives[0]).toMatchObject({
        label: "RELIGHT REBECCA",
        current: 0,
      });
    });

    it("ignores new residents in other buildings and orders that predate the operation", () => {
      const early = customer("Early", "active", 2, "2026-08-20T12:00:00.000Z");
      const elsewhere = customer(
        "Elsewhere",
        "active",
        2,
        "2026-09-05T12:00:00.000Z",
        "200 Other St"
      );
      const result = run([
        customer("Rebecca", "dark", 70),
        customer("Anita", "active", 3),
        early,
        elsewhere,
      ]);
      expect(restore(result)).toMatchObject({ current: 0, target: 1 });
      expect(result.featuredOperation.replacementRescues).toEqual([]);
    });

    it("never credits one dark lantern twice and never credits one new resident twice", () => {
      const rebecca = customer("Rebecca", "active", 1) as any;
      rebecca.lastOrderAt = "2026-09-06T12:00:00.000Z";
      const returnedAndReplaced = run([
        rebecca,
        customer("Anita", "active", 3),
        customer("Noor", "active", 2, "2026-09-05T12:00:00.000Z"),
      ]);
      expect(restore(returnedAndReplaced)).toMatchObject({ current: 1, target: 1 });
      expect(returnedAndReplaced.featuredOperation.replacementRescues).toEqual([]);

      const twoDarkOneResident = projectLanternCityOverview({
        atlas: {
          tenantId: "tenant",
          businessDate: "2026-09-08",
          timeZone: "America/Los_Angeles",
          customers: [
            customer("Rebecca", "dark", 70),
            customer("Sam", "dark", 60),
            customer("Noor", "active", 2, "2026-09-05T12:00:00.000Z"),
          ],
          pursued: [],
        } as any,
        paidRevenueThisWeek: 0,
        campaign: { campaign: { chapters: [], currentChapterId: null } } as any,
        operation: {
          ...operation,
          baselineCustomerIdentityKeys: ["rebecca", "sam"],
          baselineDormantIdentityKeys: ["rebecca", "sam"],
        },
      });
      expect(restore(twoDarkOneResident)).toMatchObject({ current: 1, target: 2 });
      expect(twoDarkOneResident.featuredOperation.replacementRescues).toHaveLength(1);
    });

    it("requires a real canonical building match, not a raw address string", () => {
      const noor = customer("Noor", "active", 2, "2026-09-05T12:00:00.000Z") as any;
      noor.location.canonicalAddress = null;
      const result = run([customer("Rebecca", "dark", 70), noor]);
      expect(restore(result)).toMatchObject({ current: 0, target: 1 });
    });
  });

  describe("rekindling state from world events", () => {
    const operation = {
      id: "op",
      stableKey: "op",
      sourceCampaignChapterId: null,
      operationType: "recovery" as const,
      campaignTerritoryDefinitionId: null,
      lanternCityTerritoryId: "silver-lake",
      startedAt: "2026-09-01T00:00:00.000Z",
      baselineCustomerIdentityKeys: ["rebecca", "anita"],
      baselineDormantIdentityKeys: ["rebecca"],
      anchorCustomerIdentityKey: "rebecca",
    };
    const send = (occurredAt: string, correlationId = "recovery-intervention:int-1") => ({
      eventType: "recovery_outreach_completed",
      classification: "action",
      occurredAt,
      correlationId,
      metadata: { arsenalTool: "signal_flare", truthClass: "system_sent" },
    });
    function run(events: ReturnType<typeof send>[], extra: object[] = []) {
      return projectLanternCityOverview({
        atlas: {
          tenantId: "tenant",
          businessDate: "2026-09-08",
          timeZone: "America/Los_Angeles",
          customers: [customer("Rebecca", "dark", 70), customer("Anita", "active", 3)],
          pursued: [],
        } as any,
        paidRevenueThisWeek: 0,
        campaign: { campaign: { chapters: [], currentChapterId: null } } as any,
        operation,
        rekindling: {
          interventions: [
            { id: "int-1", customerKey: "rebecca" },
            { id: "int-9", customerKey: "someone-else" },
          ],
          events: [...events, ...(extra as any[])],
        },
      });
    }

    it("derives spark from a real tool send since the operation began, dated in the business zone", () => {
      const result = run([send("2026-09-04T03:30:00.000Z")]);
      expect(result.featuredOperation.rekindling).toEqual([
        {
          customerIdentityKey: "rebecca",
          state: "spark",
          reached: "field_activity",
          lastToolUse: { tool: "signal_flare", businessDate: "2026-09-03" },
        },
      ]);
    });

    it("stays dark for sends before the operation or on another customer's intervention", () => {
      const result = run([
        send("2026-08-25T18:00:00.000Z"),
        send("2026-09-04T18:00:00.000Z", "recovery-intervention:int-9"),
      ]);
      expect(result.featuredOperation.rekindling).toEqual([
        { customerIdentityKey: "rebecca", state: "dark", reached: null, lastToolUse: null },
      ]);
    });

    it("reaches flame only through a real recovered-order outcome", () => {
      const result = run(
        [send("2026-09-02T18:00:00.000Z")],
        [
          {
            eventType: "customer_recovered",
            classification: "outcome",
            occurredAt: "2026-09-06T18:00:00.000Z",
            correlationId: "recovery-intervention:int-1",
            metadata: {},
          },
        ]
      );
      expect(result.featuredOperation.rekindling[0]).toMatchObject({
        state: "flame",
        reached: "customer_outcome",
      });
    });

    it("reads dark with no evidence, and lists nothing outside a recovery operation", () => {
      expect(fixture().featuredOperation.rekindling).toEqual([
        { customerIdentityKey: "rebecca", state: "dark", reached: null, lastToolUse: null },
      ]);
      const fixed = projectLanternCityOverview({
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
        rekindling: { interventions: [{ id: "int-1", customerKey: "rebecca" }], events: [send("2026-09-04T18:00:00.000Z")] },
      });
      expect(fixed.featuredOperation.rekindling).toEqual([]);
    });
  });
});

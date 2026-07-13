import { describe, expect, it } from "vitest";
import { discoverLaundryTerritory } from "../territory/territoryDiscovery";
import { DeterministicTerritoryProvider } from "../territory/testSupport/deterministicTerritoryProvider";
import {
  assertNoFabricatedExternalTruth,
  assertOrderedEventRows,
  assertPrivacySafeAnalyticsProperties,
} from "./releaseAssertions";

describe("DayForge deterministic release harness", () => {
  it("discovers ranked opportunities without network or live-provider claims", async () => {
    const result = await discoverLaundryTerritory({
      addressOrBusiness: "Release Gate Laundry",
      provider: new DeterministicTerritoryProvider(),
      operator: {
        tenantId: "release-fixture",
        serviceRadiusMiles: 3,
        commercialWashFoldEnabled: true,
        averagePricePerPoundCents: 250,
        availableWeeklyCapacityPounds: 700,
        routePoints: [],
        turnaroundCompatibleByDefault: true,
        pickupDaysCompatibleByDefault: true,
      },
      limit: 12,
    });

    expect(result.providerName).toBe("dayforge-release-fixture");
    expect(result.providerCandidateCount).toBe(3);
    expect(result.dedupedCandidateCount).toBe(2);
    expect(result.opportunities[0]?.account.name).toBe(
      "Westview Property Management"
    );
    expect(result.opportunities[0]?.evidence.map(item => item.classification)).toEqual([
      "sourced_fact",
      "operator_input",
      "deterministic_estimate",
    ]);
    expect(result.opportunities[0]?.evidence.some(item => item.classification === "ai_inference")).toBe(false);
  });

  it("rejects PII-shaped analytics properties", () => {
    expect(() =>
      assertPrivacySafeAnalyticsProperties({
        mission_status: "phone_ready",
        estimated_value_band: "20k_30k",
      })
    ).not.toThrow();
    expect(() =>
      assertPrivacySafeAnalyticsProperties({ email: "owner@example.com" })
    ).toThrow(/not allowlisted/);
    expect(() =>
      assertPrivacySafeAnalyticsProperties({ label: "+1 (555) 010-1010" })
    ).toThrow(/direct contact data/);
  });

  it("requires stable audit ordering and refuses fabricated external truth", () => {
    const at = new Date("2026-01-15T12:00:00.000Z");
    expect(() =>
      assertOrderedEventRows([
        { id: 10, createdAt: at },
        { id: 11, createdAt: at },
        { id: 12, createdAt: new Date(at.getTime() + 1) },
      ])
    ).not.toThrow();
    expect(() =>
      assertOrderedEventRows([
        { id: 11, createdAt: at },
        { id: 10, createdAt: at },
      ])
    ).toThrow(/stable ID tie-breaker/);
    expect(() =>
      assertNoFabricatedExternalTruth({
        invoicedRevenueCents: 0,
        invoiceEvidenceAvailable: false,
      })
    ).not.toThrow();
    expect(() =>
      assertNoFabricatedExternalTruth({
        invoicedRevenueCents: 12_000,
        invoiceEvidenceAvailable: false,
      })
    ).toThrow(/invoice evidence/);
  });
});

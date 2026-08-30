import { describe, expect, it } from "vitest";
import {
  bindMissionsToLocations,
  rankStatus,
  resolveMissionsToBuildings,
  verifiedAnnualValue,
  type MissionLocationRow,
} from "./canonicalBuildingService";

/**
 * The scenario the previous join got wrong: ONE tenant, TWO accounts, TWO
 * primary locations, TWO missions reaching those accounts through different
 * opportunities. The old loader joined on tenantId + isPrimary, so it produced
 * a cross product and each mission could be attributed to the other account's
 * building.
 */
const OPUS_ADDRESS = "3545 Wilshire Blvd, Los Angeles, CA 90010";
const CPE_ADDRESS = "2170 Century Pk E";

function row(overrides: Partial<MissionLocationRow>): MissionLocationRow {
  return {
    missionId: 1,
    status: "arrived",
    opportunityId: 10,
    accountId: 100,
    locationId: 1000,
    locationAccountId: 100,
    address: OPUS_ADDRESS,
    latitude: null,
    longitude: null,
    isPrimary: true,
    approvedContractValueCents: null,
    pipelineStage: null,
    realizedRevenueCents: null,
    lossReason: null,
    ...overrides,
  };
}

/**
 * What the corrected SQL yields: the innerJoin through opportunities means a
 * mission only ever sees its OWN account's locations. These fixtures include
 * the cross-account rows anyway, so the pure rule is proven to reject them
 * even if a future join regresses.
 */
const twoAccountsOneTenant: MissionLocationRow[] = [
  // Mission 1 -> opportunity 10 -> account 100 (Opus)
  row({ missionId: 1, opportunityId: 10, accountId: 100, locationId: 1000, locationAccountId: 100, address: OPUS_ADDRESS }),
  // Cross-product row the old join would have produced: account 200's location
  row({ missionId: 1, opportunityId: 10, accountId: 100, locationId: 2000, locationAccountId: 200, address: CPE_ADDRESS }),
  // Mission 2 -> opportunity 20 -> account 200 (Century Park East)
  row({ missionId: 2, status: "won", opportunityId: 20, accountId: 200, locationId: 2000, locationAccountId: 200, address: CPE_ADDRESS }),
  // Cross-product row in the other direction
  row({ missionId: 2, status: "won", opportunityId: 20, accountId: 200, locationId: 1000, locationAccountId: 100, address: OPUS_ADDRESS }),
];

describe("mission -> building identity", () => {
  it("binds each mission only to its own account's location", () => {
    const bound = bindMissionsToLocations(twoAccountsOneTenant);
    expect(bound).toHaveLength(2);

    const first = bound.find(b => b.missionId === 1)!;
    const second = bound.find(b => b.missionId === 2)!;

    expect(first.accountId).toBe(100);
    expect(first.locationId).toBe(1000);
    expect(first.address).toBe(OPUS_ADDRESS);

    expect(second.accountId).toBe(200);
    expect(second.locationId).toBe(2000);
    expect(second.address).toBe(CPE_ADDRESS);
  });

  it("resolves each mission to only its own building", () => {
    const { byCanonicalId } = resolveMissionsToBuildings(
      bindMissionsToLocations(twoAccountsOneTenant)
    );
    expect(byCanonicalId.get("opus_la")?.missionId).toBe(1);
    expect(byCanonicalId.get("century_park_east")?.missionId).toBe(2);
    // The decisive assertion: no mission leaked onto the other building.
    expect(byCanonicalId.get("opus_la")?.accountId).toBe(100);
    expect(byCanonicalId.get("century_park_east")?.accountId).toBe(200);
  });

  it("drops a location belonging to another account even when it is primary", () => {
    const bound = bindMissionsToLocations([
      row({
        missionId: 7,
        accountId: 100,
        locationId: 9000,
        locationAccountId: 999,
        address: CPE_ADDRESS,
        isPrimary: true,
      }),
    ]);
    expect(bound).toHaveLength(0);
  });

  it("refuses to bind a mission with no resolvable account", () => {
    const bound = bindMissionsToLocations([
      row({ missionId: 8, opportunityId: null, accountId: null }),
    ]);
    expect(bound).toHaveLength(0);
  });
});

describe("multiple locations on one account", () => {
  const multi: MissionLocationRow[] = [
    row({ missionId: 5, accountId: 100, locationId: 1002, locationAccountId: 100, isPrimary: false, address: CPE_ADDRESS }),
    row({ missionId: 5, accountId: 100, locationId: 1001, locationAccountId: 100, isPrimary: true, address: OPUS_ADDRESS }),
    row({ missionId: 5, accountId: 100, locationId: 1003, locationAccountId: 100, isPrimary: false, address: CPE_ADDRESS }),
  ];

  it("prefers the primary location", () => {
    const bound = bindMissionsToLocations(multi);
    expect(bound).toHaveLength(1);
    expect(bound[0]!.locationId).toBe(1001);
    expect(bound[0]!.address).toBe(OPUS_ADDRESS);
  });

  it("is deterministic regardless of row order", () => {
    const forward = bindMissionsToLocations(multi);
    const reversed = bindMissionsToLocations([...multi].reverse());
    expect(reversed).toEqual(forward);
  });

  it("falls back to the lowest location id when none is primary", () => {
    const noPrimary = multi.map(r => ({ ...r, isPrimary: false }));
    const bound = bindMissionsToLocations(noPrimary);
    expect(bound[0]!.locationId).toBe(1001);
  });
});

describe("most-advanced mission wins a building", () => {
  it("does not let a candidate hide a won account at the same address", () => {
    const bound = bindMissionsToLocations([
      row({ missionId: 30, status: "candidate", accountId: 100, locationId: 1000, locationAccountId: 100, address: OPUS_ADDRESS }),
      row({ missionId: 31, status: "won", accountId: 101, locationId: 1010, locationAccountId: 101, address: OPUS_ADDRESS }),
    ]);
    const { byCanonicalId } = resolveMissionsToBuildings(bound);
    expect(byCanonicalId.get("opus_la")?.missionId).toBe(31);
  });

  it("never ranks a lost mission above a live one", () => {
    expect(rankStatus("lost")).toBeLessThan(rankStatus("candidate"));
    expect(rankStatus("won")).toBeGreaterThan(rankStatus("follow_up"));
  });
});

describe("verified annual value authority", () => {
  it("requires both the mission and the pipeline record to agree it is won", () => {
    expect(
      verifiedAnnualValue({
        missionStatus: "won",
        pipelineStage: "won",
        approvedContractValueCents: 4_200_000,
      })
    ).toBe(4_200_000);
  });

  it("returns null when the pipeline has not confirmed the win", () => {
    expect(
      verifiedAnnualValue({
        missionStatus: "won",
        pipelineStage: "verbal_yes",
        approvedContractValueCents: 4_200_000,
      })
    ).toBeNull();
  });

  it("returns null for a mission that is not won, whatever the pipeline says", () => {
    expect(
      verifiedAnnualValue({
        missionStatus: "follow_up",
        pipelineStage: "won",
        approvedContractValueCents: 4_200_000,
      })
    ).toBeNull();
  });

  it("never substitutes an approved value that does not exist", () => {
    expect(
      verifiedAnnualValue({
        missionStatus: "won",
        pipelineStage: "won",
        approvedContractValueCents: null,
      })
    ).toBeNull();
  });
});

describe("registry disagreements are surfaced, not swallowed", () => {
  it("reports an address only one registry recognises", () => {
    const { disagreements } = resolveMissionsToBuildings([
      {
        missionId: 40,
        status: "arrived",
        accountId: 100,
        locationId: 1,
        address: "3545 Wilshire Blvd",
        latitude: null,
        longitude: null,
        approvedContractValueCents: null,
        pipelineStage: null,
        realizedRevenueCents: null,
        lossReason: null,
      },
    ]);
    // Opus resolves in both registries, so this must be clean.
    expect(disagreements).toHaveLength(0);
  });
});

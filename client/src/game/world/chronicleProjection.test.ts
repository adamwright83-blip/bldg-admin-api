import { describe, expect, it } from "vitest";
import { projectChronicle } from "./chronicleProjection";
import type { DriverGameWorldNode } from "../../../../shared/driverGameWorld";

function node(overrides: Partial<DriverGameWorldNode> = {}): DriverGameWorldNode {
  return {
    missionId: 1,
    entityType: "commercial_mission",
    entityId: "1",
    accountId: 1,
    accountName: "Real Account",
    locationId: 1,
    missionStatus: "won",
    visualState: "captured",
    worldAnchor: "fortress_gate",
    unlockedPath: null,
    discoveryState: "engaged",
    contestedUntil: null,
    verifiedAnnualValueCents: 240_000,
    realizedRevenueCents: 0,
    lossReason: null,
    version: 1,
    isTodayActive: false,
    isHistorical: true,
    regionKey: "fortress_gate",
    resolvedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("projectChronicle", () => {
  it("is empty when there is no authoritative history", () => {
    expect(projectChronicle([])).toEqual([]);
  });

  it("uses only real isHistorical nodes — no invented entries", () => {
    const nodes = [node({ missionId: 1, isHistorical: true }), node({ missionId: 2, isHistorical: false })];
    const chronicle = projectChronicle(nodes);
    expect(chronicle).toHaveLength(1);
    expect(chronicle[0]!.mission.missionId).toBe(1);
  });

  it("pairs each entry with the same semantic mutation the live world would show", () => {
    const chronicle = projectChronicle([node({ visualState: "captured" })]);
    expect(chronicle[0]!.mutation.destinationTreatment).toBe("illuminated");
    expect(chronicle[0]!.mutation.isSettled).toBe(true);
  });

  it("a lost mission renders as a receding/dormant scar, not a trophy", () => {
    const chronicle = projectChronicle([
      node({ visualState: "closed", missionStatus: "lost", lossReason: "budget", verifiedAnnualValueCents: null }),
    ]);
    expect(chronicle[0]!.mutation.routeTreatment).toBe("receding");
    expect(chronicle[0]!.mutation.destinationTreatment).toBe("dormant");
  });

  it("carries the real resolvedAt timestamp — never fabricated", () => {
    const chronicle = projectChronicle([node({ resolvedAt: "2026-07-04T00:00:00.000Z" })]);
    expect(chronicle[0]!.resolvedAt).toBe("2026-07-04T00:00:00.000Z");
  });

  it("is not a trophy cabinet: no score, XP, or streak field exists anywhere in the entry", () => {
    const chronicle = projectChronicle([node()]);
    const entry = chronicle[0]!;
    expect(entry).not.toHaveProperty("xp");
    expect(entry).not.toHaveProperty("score");
    expect(entry).not.toHaveProperty("streak");
  });
});

import { describe, expect, it } from "vitest";
import {
  assertCommercialMissionContinuity,
  formatMissionCode,
  toCommercialMissionContinuitySurface,
  type CommercialMission,
} from "./commercialMission";

export const TEST_COMMERCIAL_MISSION: CommercialMission = {
  id: 42,
  tenantId: "tenant-a",
  code: "MISSION 042",
  status: "game_ready",
  version: 1,
  assignedTo: "operator-1",
  opsTaskId: 91,
  account: {
    accountId: 7,
    name: "Westview Property Management",
    accountType: "Property management",
    address: "Los Angeles, CA",
    latitude: 34.0522,
    longitude: -118.2437,
    locationCount: 15,
    decisionMaker: { name: "Dana R.", title: "Operations Manager" },
  },
  opportunity: {
    opportunityId: 12,
    estimatedAnnualValueCents: 2_480_000,
    estimateConfidence: "high",
    score: 87,
    primarySignal: "Expanded to 15 buildings",
    reasons: ["Decision-maker identified"],
    risks: ["Current provider unknown"],
  },
  brief: {
    laundryOpportunity: "Centralized recurring laundry service",
    salesAngle: "One provider and one invoice",
    openingLine: "Who handles laundry across the portfolio?",
    discoveryQuestions: ["How is laundry handled today?"],
    objections: ["Current provider"],
  },
  steps: [],
  expiresAt: null,
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
  completedAt: null,
};

describe("commercial mission continuity", () => {
  it("formats a stable mission code", () => {
    expect(formatMissionCode(42)).toBe("MISSION 042");
  });

  it("accepts identical persisted snapshots across surfaces", () => {
    const surface = toCommercialMissionContinuitySurface(TEST_COMMERCIAL_MISSION);
    expect(() => assertCommercialMissionContinuity(TEST_COMMERCIAL_MISSION, [surface, surface])).not.toThrow();
  });

  it("rejects account drift", () => {
    const surface = toCommercialMissionContinuitySurface(TEST_COMMERCIAL_MISSION);
    expect(() =>
      assertCommercialMissionContinuity(TEST_COMMERCIAL_MISSION, [{ ...surface, accountName: "Westview Mgmt" }]),
    ).toThrow(/continuity failed/);
  });
});

import { describe, expect, it } from "vitest";
import type { RankedTerritoryOpportunity } from "./territoryDiscovery";
import { buildPublicPreviewSampleMission } from "./publicPreviewMission";

const opportunity = {
  candidateKey: "provider:westview",
  providerName: "provider",
  providerAccountId: "westview",
  account: {
    name: "Westview Property Management",
    accountType: "property_management",
    address: "400 Westview Ave",
    latitude: 34.05,
    longitude: -118.24,
    locationCount: 15,
    decisionMaker: { name: "Dana R.", title: "Operations Manager" },
    website: null,
    phone: null,
  },
  score: {
    score: 87,
    grade: "high",
    estimatedAnnualValueCents: 2_480_000,
    estimatedWeeklyPounds: 700,
    estimatedMonthlyOrders: 4,
    reasons: ["Multiple locations"],
    risks: [],
  },
  primarySignal: "15 managed locations",
  distanceMiles: 0.2,
  evidence: [],
} as RankedTerritoryOpportunity;

describe("public territory preview sample mission", () => {
  it("builds a useful mission without a persisted tenant mission id", () => {
    const mission = buildPublicPreviewSampleMission({
      sessionId: "preview-session",
      opportunity,
    });
    expect(mission.id).toContain("preview:preview-session");
    expect(mission.code).toBe("MISSION PREVIEW");
    expect(mission.status).toBe("sample");
    expect(mission.account.name).toBe("Westview Property Management");
    expect(mission.opportunity.estimatedAnnualValueCents).toBe(2_480_000);
    expect(mission.steps.map(step => step.status)).toEqual([
      "completed",
      "ready",
      "locked",
      "locked",
    ]);
  });
});

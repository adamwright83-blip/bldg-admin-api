import { describe, expect, it } from "vitest";
import {
  evaluateExpansionScout,
  type ExpansionScoutEvidence,
} from "./expansionScout";

const ready: ExpansionScoutEvidence = {
  verifiedWin: true,
  accountArchetype: "property_management",
  accountAddress: "100 Sourced Ave, Los Angeles, CA",
  latitude: 34.05,
  longitude: -118.24,
  serviceType: "commercial_wash_fold",
  serviceRadiusMiles: 5,
  commercialServiceEnabled: true,
  sourceReferences: [
    "commercial_missions:1",
    "territory_operator_profiles:tenant",
  ],
};

describe("Expansion Scout capability evaluation", () => {
  it("locks without a verified commercial win", () => {
    expect(
      evaluateExpansionScout({ ...ready, verifiedWin: false }).eligible
    ).toBe(false);
  });

  it("locks a verified win with insufficient replication evidence", () => {
    const result = evaluateExpansionScout({
      ...ready,
      accountArchetype: "other",
      latitude: null,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/archetype|location/i);
  });

  it("unlocks only with verified archetype, geography, and service evidence", () => {
    expect(evaluateExpansionScout(ready).eligible).toBe(true);
  });

  it("ignores arcade score, XP, and combo streak inputs", () => {
    const contaminated = {
      ...ready,
      verifiedWin: false,
      arcadePerfect: true,
      xp: 999_999,
      combo: 99,
    } as ExpansionScoutEvidence & Record<string, unknown>;
    expect(evaluateExpansionScout(contaminated).eligible).toBe(false);
  });
});

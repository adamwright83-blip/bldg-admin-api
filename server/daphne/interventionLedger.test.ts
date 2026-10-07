import { describe, expect, it } from "vitest";
import { validateDaphneIntervention } from "./interventionLedger";

const base = {
  tenantId: "t", canonicalOperatorId: "o", agentId: "claire",
  decisionPointId: "d1", contextKey: "execution",
  acceptableActions: ["brief", "ask", "no_intervention"],
  chosenAction: "brief", selectionMode: "randomized" as const,
  selectionProbability: 0.5, propensity: { brief: 0.5, ask: 0.25, no_intervention: 0.25 },
  policyVersion: "v2", sourceObservationIds: ["obs1"], idempotencyKey: "i1",
};

describe("Daphne V2 InterventionLedger", () => {
  it("requires the chosen action to have been acceptable", () => {
    expect(() => validateDaphneIntervention({ ...base, chosenAction: "pressure" })).toThrow(/acceptable/);
  });
  it("requires logged probability for learning-capable selection", () => {
    expect(() => validateDaphneIntervention({ ...base, selectionProbability: null })).toThrow(/selectionProbability/);
  });
  it("rejects fake propensity distributions", () => {
    expect(() => validateDaphneIntervention({ ...base, propensity: { brief: .9, ask: .9 } })).toThrow(/sum to 1/);
  });
  it("accepts no-intervention as a legitimate action when explicitly eligible", () => {
    expect(() => validateDaphneIntervention({
      ...base, chosenAction: "no_intervention", selectionProbability: .25
    })).not.toThrow();
  });
});

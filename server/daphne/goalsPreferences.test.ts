import { describe, expect, it } from "vitest";
import {
  daphneAdaptationAllowed,
  validateDaphneMetaPreferenceValue,
  type DaphneMetaPreferenceRecord,
} from "./goalsPreferences";

describe("Daphne V2 goals and MetaPreferences", () => {
  it("treats explicit adaptation disable as authoritative", () => {
    const pref: DaphneMetaPreferenceRecord = {
      id: "p1", tenantId: "t", canonicalOperatorId: "o",
      preferenceKey: "adaptation_enabled", value: false, version: 1,
      sourceObservationId: "obs", status: "active", createdAt: new Date().toISOString(),
    };
    expect(daphneAdaptationAllowed({ adaptation_enabled: pref })).toBe(false);
  });

  it("fails closed on invalid experimentation controls", () => {
    expect(() => validateDaphneMetaPreferenceValue("safe_experimentation", "yes")).toThrow(/boolean/);
    expect(() => validateDaphneMetaPreferenceValue("safe_experimentation", true)).not.toThrow();
  });

  it("requires normalized continuous style controls", () => {
    expect(() => validateDaphneMetaPreferenceValue("response_directness", 1.2)).toThrow(/\[0,1\]/);
    expect(() => validateDaphneMetaPreferenceValue("response_directness", 0.8)).not.toThrow();
  });
});

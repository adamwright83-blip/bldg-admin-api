import { describe, expect, it } from "vitest";
import { detectExplicitDaphnePreferenceCorrections } from "./explicitPreferenceCorrection";

describe("Daphne V2 explicit preference correction parser", () => {
  it("captures direct natural-language corrections without inference", () => {
    const corrections = detectExplicitDaphnePreferenceCorrections(
      "Claire, stop repeating yourself and keep your answers shorter."
    );
    expect(corrections).toEqual([
      {
        preferenceKey: "avoid_repetition",
        value: true,
        evidenceText: "Claire, stop repeating yourself and keep your answers shorter.",
      },
      {
        preferenceKey: "response_detail",
        value: 0.2,
        evidenceText: "Claire, stop repeating yourself and keep your answers shorter.",
      },
    ]);
  });

  it("captures directness and challenge corrections", () => {
    expect(
      detectExplicitDaphnePreferenceCorrections("Be more direct with me.")
    ).toEqual([
      expect.objectContaining({
        preferenceKey: "response_directness",
        value: 0.9,
      }),
    ]);
    expect(
      detectExplicitDaphnePreferenceCorrections("Don't push me so hard.")
    ).toEqual([
      expect.objectContaining({
        preferenceKey: "challenge_level",
        value: 0.2,
      }),
    ]);
  });

  it("does not turn a hypothetical question into a preference", () => {
    expect(
      detectExplicitDaphnePreferenceCorrections(
        "Would it be better if you were more direct?"
      )
    ).toEqual([]);
  });
});

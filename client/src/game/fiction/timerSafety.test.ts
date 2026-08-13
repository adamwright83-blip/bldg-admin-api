import { describe, expect, it } from "vitest";
import { shouldAdvanceTimer, shouldPauseTimer } from "./timerSafety";
import type { FictionTemplate } from "../../../../shared/fictionTemplate";

function template(overrides: Partial<FictionTemplate> = {}): FictionTemplate {
  return {
    id: "t",
    rulesVersion: 1,
    compatibleGrammarKinds: ["PLACE_ITEM_AT_LOCATIONS"],
    title: "T",
    briefing: () => "",
    physicalInstruction: () => "",
    stakes: "",
    successTreatment: { headline: "", detail: "" },
    failureTreatment: { headline: "", detail: "" },
    worldReturnTreatment: "",
    timerEligible: true,
    drivingCompatible: false,
    attentionSafetyClass: "safe_walking",
    humanInteractionCompatible: false,
    ...overrides,
  };
}

describe("shouldAdvanceTimer", () => {
  it("advances for a timer-eligible, safe, non-driving template", () => {
    expect(shouldAdvanceTimer(template(), { isDriving: false })).toBe(true);
  });

  it("never advances for a template that was never timer-eligible", () => {
    expect(shouldAdvanceTimer(template({ timerEligible: false }), { isDriving: false })).toBe(false);
  });

  it("driving cannot receive an active attention-demanding countdown", () => {
    expect(shouldAdvanceTimer(template(), { isDriving: true })).toBe(false);
  });

  it("an unsafe-while-driving safety class never advances even when not currently driving", () => {
    const unsafe = template({ attentionSafetyClass: "unsafe_while_driving" });
    expect(shouldAdvanceTimer(unsafe, { isDriving: false })).toBe(false);
  });
});

describe("shouldPauseTimer", () => {
  it("pauses a running timer the instant a driving signal appears", () => {
    expect(shouldPauseTimer(template(), { isDriving: true })).toBe(true);
  });

  it("does not report a pause for a template that never had a timer", () => {
    expect(shouldPauseTimer(template({ timerEligible: false }), { isDriving: true })).toBe(false);
  });

  it("does not pause a stationary, non-driving safe timer", () => {
    expect(shouldPauseTimer(template(), { isDriving: false })).toBe(false);
  });
});

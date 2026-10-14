import { describe, expect, it } from "vitest";
import {
  classifyMissionExplanation,
  missionFollowUpQuestion,
  parseMissionAdjustment,
} from "./daphneMissionPresentation";

describe("Daphne mission explanation classification", () => {
  it("maps explicit reasons to presentation-only adjustments", () => {
    expect(classifyMissionExplanation("It was too much at once").adjustment).toEqual({ kind: "task_size", firstStepOnly: true });
    expect(classifyMissionExplanation("I ran out of time by the afternoon").adjustment).toEqual({ kind: "timing", window: "morning" });
    expect(classifyMissionExplanation("Just text me the night before").adjustment?.kind).toBe("delivery_channel");
    expect(classifyMissionExplanation("Too much story, just tell me what to do").adjustment).toEqual({ kind: "presentation_style", style: "plain" });
  });
  it("records practical blockers without changing presentation", () => {
    expect(classifyMissionExplanation("The truck had a flat tire")).toEqual({ reason: "blocked", epistemic: "explicit", adjustment: null });
  });
  it("never infers an adjustment from an unrecognised answer", () => {
    expect(classifyMissionExplanation("eh, stuff happened")).toEqual({ reason: "unclassified", epistemic: "hypothesis", adjustment: null });
  });
  it("never offers an immersion increase", () => {
    expect(parseMissionAdjustment({ kind: "presentation_style", style: "immersive" })).toBeNull();
    expect(parseMissionAdjustment({ kind: "immersion", level: 5 })).toBeNull();
  });
  it("asks one natural question per mission type", () => {
    expect(missionFollowUpQuestion("retention")).toBe("What happened with that customer recovery mission?");
    expect(missionFollowUpQuestion("unknown_kind")).toBe("What happened with that mission?");
  });
});

describe("adjustment scope", () => {
  it("time-of-day reasons apply to every mission; task size stays with its mission type", async () => {
    const { adjustmentScope, presentationFor, OPERATOR_SCOPE } = await import("../server/agents/daphne/missionFollowUp");
    const timing = classifyMissionExplanation("I ran out of time; afternoons are too busy.");
    expect(timing.adjustment).toEqual({ kind: "timing", window: "morning" });
    expect(adjustmentScope(timing.adjustment!)).toBe("operator");
    expect(adjustmentScope({ kind: "task_size" })).toBe("mission_type");
    const map = new Map([[OPERATOR_SCOPE, "morning"], ["retention", "first-step"]]);
    expect(presentationFor(map, "account_acquisition")).toBe("morning");
    expect(presentationFor(map, "retention")).toBe("first-step");
  });
});

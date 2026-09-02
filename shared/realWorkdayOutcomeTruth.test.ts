import { describe, expect, it } from "vitest";
import { missionStatusForFieldVisitOutcome } from "./commercialMissionField";
import { missionStatusForFollowUpOutcome } from "./commercialPipeline";

describe("Real Workday outcome truth", () => {
  it("keeps unresolved visits completed but unresolved", () => {
    expect(missionStatusForFieldVisitOutcome("no_contact")).toBeNull();
    expect(missionStatusForFieldVisitOutcome("no_decision")).toBeNull();
  });

  it("only explicit visit outcomes authorize a second mission transition", () => {
    expect(missionStatusForFieldVisitOutcome("follow_up")).toBe("follow_up");
    expect(missionStatusForFieldVisitOutcome("won")).toBe("won");
    expect(missionStatusForFieldVisitOutcome("lost")).toBe("lost");
  });

  it("does not turn follow-up activity or contact into a win", () => {
    expect(missionStatusForFollowUpOutcome("no_contact")).toBeNull();
    expect(missionStatusForFollowUpOutcome("contacted_no_decision")).toBeNull();
  });

  it("allows terminal follow-up truth only when explicitly recorded", () => {
    expect(missionStatusForFollowUpOutcome("won")).toBe("won");
    expect(missionStatusForFollowUpOutcome("lost")).toBe("lost");
  });
});

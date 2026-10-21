import { describe, expect, it } from "vitest";
import { resolveDaphneExperienceContinuity } from "./experienceContinuity";

const day1 = { experienceId: "kingdom1_day1_ten_doors", recordedProgress: 3, campaignComplete: false };

describe("Daphne experience continuity", () => {
  it("never switches an experience with recorded progress (Day 1 at 3 of 5), even at a boundary claim", () => {
    expect(resolveDaphneExperienceContinuity({ explicitChoice: null, inProgress: day1, atNewCampaignBoundary: true })).toEqual({
      action: "keep_in_progress", experienceId: "kingdom1_day1_ten_doors", reason: "recorded_progress",
    });
  });
  it("lets an explicit operator choice win", () => {
    expect(resolveDaphneExperienceContinuity({ explicitChoice: { experienceId: "cozy_visits", sourceRef: "daphne_observations:o1" }, inProgress: day1, atNewCampaignBoundary: false }).action).toBe("keep_explicit_choice");
  });
  it("selects only at a new-campaign boundary or when nothing is in progress", () => {
    const done = { ...day1, recordedProgress: 5, campaignComplete: true };
    expect(resolveDaphneExperienceContinuity({ explicitChoice: null, inProgress: done, atNewCampaignBoundary: false }).action).toBe("keep_in_progress");
    expect(resolveDaphneExperienceContinuity({ explicitChoice: null, inProgress: done, atNewCampaignBoundary: true })).toEqual({ action: "select", reason: "new_campaign_boundary" });
    expect(resolveDaphneExperienceContinuity({ explicitChoice: null, inProgress: null, atNewCampaignBoundary: false })).toEqual({ action: "select", reason: "nothing_in_progress" });
  });
});

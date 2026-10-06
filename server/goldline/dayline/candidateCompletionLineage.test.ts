import { describe, expect, it } from "vitest";
import { resolveCandidateCompletionLineage } from "./candidateCompletionLineage";

describe("candidate Day Line completion lineage", () => {
  it("prefers a concrete Day Director commitment over a campaign donor", () => {
    expect(
      resolveCandidateCompletionLineage([
        {
          sourceKind: "unfinished_growth_work",
          sourceType: "day_director_commitment",
          sourceId: "commit-1",
        },
        {
          sourceKind: "campaign_library",
          sourceType: "campaign_template",
          sourceId: "campaign-1",
        },
      ])
    ).toEqual({
      kind: "commitment",
      sourceReference: "day_director_commitments:commit-1",
      commitmentId: "commit-1",
    });
  });

  it("routes a campaign candidate through the existing campaign evidence contract", () => {
    expect(
      resolveCandidateCompletionLineage([
        {
          sourceKind: "campaign_library",
          sourceType: "campaign_template",
          sourceId: "campaign-1",
        },
      ])
    ).toEqual({
      kind: "campaign",
      sourceReference: "campaign:campaign-1",
      campaignId: "campaign-1",
    });
  });

  it("fails closed for candidate sources without an existing generic completion authority", () => {
    expect(
      resolveCandidateCompletionLineage([
        {
          sourceKind: "commercial_follow_up",
          sourceType: "commercial_follow_up",
          sourceId: "followup-1",
        },
      ])
    ).toBeNull();
  });
});

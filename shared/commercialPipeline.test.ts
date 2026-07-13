import { describe, expect, it } from "vitest";
import {
  canAdvanceRelationshipStage,
  commercialPipelineStageRank,
  pipelineStageForMissionStatus,
} from "./commercialPipeline";

describe("commercial pipeline mapping", () => {
  it("maps the mission lifecycle through one explicit pipeline projection", () => {
    expect(pipelineStageForMissionStatus({ status: "candidate" })).toBe(
      "mission_created"
    );
    expect(pipelineStageForMissionStatus({ status: "game_active" })).toBe(
      "game_ready"
    );
    expect(pipelineStageForMissionStatus({ status: "phone_ready" })).toBe(
      "field_ready"
    );
    expect(pipelineStageForMissionStatus({ status: "arrived" })).toBe(
      "visited"
    );
    expect(
      pipelineStageForMissionStatus({
        status: "follow_up",
        pilotRequested: true,
      })
    ).toBe("pilot_requested");
    expect(pipelineStageForMissionStatus({ status: "won" })).toBe("won");
  });

  it("keeps relationship-only movement controlled", () => {
    expect(canAdvanceRelationshipStage("follow_up", "verbal_yes")).toBe(true);
    expect(canAdvanceRelationshipStage("proposal_sent", "follow_up")).toBe(
      true
    );
    expect(canAdvanceRelationshipStage("game_ready", "verbal_yes")).toBe(false);
  });

  it("defines a stable forward rank for automatic lifecycle movement", () => {
    expect(commercialPipelineStageRank("won")).toBeGreaterThan(
      commercialPipelineStageRank("visited")
    );
  });
});

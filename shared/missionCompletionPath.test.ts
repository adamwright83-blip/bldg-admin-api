import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pipelineStageForMissionStatus } from "./commercialPipeline";
import { visualStateForBusinessStatus } from "./driverGameWorld";
import {
  completionPathFromLedger,
  directPathLedger,
  ledgerReachesSharedObjective,
  missionNeedsSameFieldDispatch,
  missionOffersBothCompletionPaths,
  objectiveForCompletionPath,
  playPathLedger,
  SHARED_MISSION_OBJECTIVE,
} from "./missionCompletionPath";

const gameService = readFileSync(
  new URL(
    "../server/commercialMissions/commercialMissionGameService.ts",
    import.meta.url
  ),
  "utf8"
);

describe("play and direct completion of the same mission", () => {
  it("offers both paths only while the play ceremony is still the gate", () => {
    expect(missionOffersBothCompletionPaths("game_ready")).toBe(true);
    expect(missionOffersBothCompletionPaths("game_active")).toBe(true);
    expect(missionOffersBothCompletionPaths("phone_ready")).toBe(false);
    expect(missionOffersBothCompletionPaths("selected")).toBe(false);
  });

  it.each(["game_ready", "game_active"] as const)(
    "reaches the same objective from %s and records which path was taken",
    from => {
      const play = playPathLedger(from);
      const direct = directPathLedger(from);
      const playObjective = objectiveForCompletionPath("play");
      const directObjective = objectiveForCompletionPath("direct");

      expect(ledgerReachesSharedObjective(play)).toBe(true);
      expect(ledgerReachesSharedObjective(direct)).toBe(true);
      expect(play[play.length - 1]?.toStatus).toBe(SHARED_MISSION_OBJECTIVE.status);
      expect(direct[direct.length - 1]?.toStatus).toBe(playObjective.status);
      expect(directObjective.status).toBe(playObjective.status);
      expect(directObjective.pipelineStage).toBe(playObjective.pipelineStage);
      expect(directObjective.worldVisualState).toBe(playObjective.worldVisualState);
      expect(pipelineStageForMissionStatus({ status: "phone_ready" })).toBe(
        pipelineStageForMissionStatus({ status: "game_completed" })
      );
      expect(visualStateForBusinessStatus({ missionStatus: "phone_ready" })).toBe(
        "active"
      );
      expect(visualStateForBusinessStatus({ missionStatus: "game_ready" })).toBe(
        "available"
      );

      expect(completionPathFromLedger(play)).toBe("play");
      expect(completionPathFromLedger(direct)).toBe("direct");
      expect(playObjective.completionPath).toBe("play");
      expect(directObjective.completionPath).toBe("direct");
      expect(directObjective.awardsXp).toBe(false);
      expect(directObjective.awardsStreak).toBe(false);
      expect(direct[0]?.metadata).toMatchObject({
        completionPath: "direct",
        gameXpAwarded: false,
        streakAwarded: false,
        worldVisualState: "active",
      });
      expect(play.some(event => event.eventName === "direct_objective_completed")).toBe(
        false
      );
    }
  );

  it("keeps the existing play service on the same objective without a second reward system", () => {
    expect(gameService).toContain('toStatus: "game_completed"');
    expect(gameService).toContain('toStatus: "phone_ready"');
    expect(gameService).toContain("calculateCommercialMissionXp");
    expect(gameService).toContain(
      'dispatchPolicy: "on_game_complete"'
    );
    expect(gameService).toContain("includeSms: false");
    expect(gameService).toContain(
      "mission?.assignedTo && mission.steps.some(step => step.type !== \"generic\")"
    );
    expect(objectiveForCompletionPath("direct").awardsXp).toBe(false);
    expect(
      missionNeedsSameFieldDispatch({
        assignedTo: "ada",
        steps: [{ type: "field_visit" }],
      })
    ).toBe(true);
    expect(
      missionNeedsSameFieldDispatch({
        assignedTo: "ada",
        steps: [{ type: "generic" }],
      })
    ).toBe(false);
    expect(
      missionNeedsSameFieldDispatch({
        assignedTo: null,
        steps: [{ type: "field_visit" }],
      })
    ).toBe(false);
  });
});

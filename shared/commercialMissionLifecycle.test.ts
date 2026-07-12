import { describe, expect, it } from "vitest";
import { DEMO_MISSION } from "./commercialMission";
import {
  canTransitionCommercialMission,
  isTerminalCommercialMissionStatus,
  transitionCommercialMission,
} from "./commercialMissionLifecycle";

describe("commercial mission lifecycle", () => {
  it("supports the complete game-to-field path", () => {
    let mission = { ...DEMO_MISSION, status: "selected" as const };

    mission = transitionCommercialMission(mission, "game_ready", {
      actorType: "system",
      occurredAt: "2026-07-12T10:00:00.000Z",
    }).mission;
    mission = transitionCommercialMission(mission, "game_active", {
      actorType: "game",
      occurredAt: "2026-07-12T10:01:00.000Z",
    }).mission;
    mission = transitionCommercialMission(mission, "game_completed", {
      actorType: "game",
      occurredAt: "2026-07-12T10:03:00.000Z",
    }).mission;
    mission = transitionCommercialMission(mission, "phone_ready", {
      actorType: "system",
      occurredAt: "2026-07-12T10:03:01.000Z",
    }).mission;
    mission = transitionCommercialMission(mission, "preparing", {
      actorType: "operator",
      occurredAt: "2026-07-12T10:04:00.000Z",
    }).mission;
    mission = transitionCommercialMission(mission, "en_route", {
      actorType: "driver",
      occurredAt: "2026-07-12T10:15:00.000Z",
    }).mission;
    mission = transitionCommercialMission(mission, "arrived", {
      actorType: "driver",
      occurredAt: "2026-07-12T10:28:00.000Z",
    }).mission;
    mission = transitionCommercialMission(mission, "visit_completed", {
      actorType: "driver",
      occurredAt: "2026-07-12T10:45:00.000Z",
    }).mission;
    mission = transitionCommercialMission(mission, "won", {
      actorType: "operator",
      occurredAt: "2026-07-12T15:00:00.000Z",
    }).mission;

    expect(mission.status).toBe("won");
    expect(isTerminalCommercialMissionStatus(mission.status)).toBe(true);
  });

  it("blocks skipping directly from game ready to the phone", () => {
    expect(canTransitionCommercialMission("game_ready", "phone_ready")).toBe(false);
    expect(() =>
      transitionCommercialMission(
        { ...DEMO_MISSION, status: "game_ready" },
        "phone_ready",
        { actorType: "system" }
      )
    ).toThrow(/invalid commercial mission transition/i);
  });
});

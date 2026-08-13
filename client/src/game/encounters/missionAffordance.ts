import type { PlayableMission } from "../state/GameState";

export const MISSION_AFFORDANCES = [
  "APPROACH",
  "CALL",
  "VISIT",
  "FOLLOW_UP",
  "RECOVER",
  "SCOUT",
  "REVIEW",
  "WAIT",
] as const;

export type MissionAffordance = (typeof MISSION_AFFORDANCES)[number];

export type MissionAffordanceProjection = {
  primary: MissionAffordance | null;
  available: readonly MissionAffordance[];
  worldSignal:
    | "signal"
    | "threshold"
    | "repeat"
    | "fracture"
    | "discovery"
    | "dormant"
    | "review"
    | "none";
};

/** Deterministic projection from business-backed mission fields only. */
export function projectMissionAffordance(
  mission: PlayableMission,
  now: Date
): MissionAffordanceProjection {
  if (mission.state === "captured" || mission.state === "closed") {
    return { primary: null, available: [], worldSignal: "none" };
  }
  if (
    mission.state === "recovery_active" ||
    mission.state === "recovery_available"
  ) {
    return {
      primary: "RECOVER",
      available: ["RECOVER"],
      worldSignal: "fracture",
    };
  }
  if (mission.contestedUntil) {
    const due = new Date(mission.contestedUntil);
    if (Number.isFinite(due.getTime()) && due.getTime() > now.getTime()) {
      return {
        primary: "WAIT",
        available: ["WAIT", "REVIEW"],
        worldSignal: "dormant",
      };
    }
    return {
      primary: "FOLLOW_UP",
      available: ["FOLLOW_UP", "REVIEW"],
      worldSignal: "repeat",
    };
  }
  if (mission.state === "watching") {
    return {
      primary: "WAIT",
      available: ["WAIT", "REVIEW"],
      worldSignal: "dormant",
    };
  }
  if (mission.phoneUrl) {
    return {
      primary: "CALL",
      available: ["CALL", "REVIEW"],
      worldSignal: "signal",
    };
  }
  if (mission.address && mission.navigationUrl) {
    return {
      primary: "VISIT",
      available: ["VISIT", "REVIEW"],
      worldSignal: "threshold",
    };
  }
  if (mission.missionId == null && mission.moveId != null) {
    return { primary: "SCOUT", available: ["SCOUT"], worldSignal: "discovery" };
  }
  return { primary: "REVIEW", available: ["REVIEW"], worldSignal: "review" };
}

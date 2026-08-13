import type { PlayableMission } from "../state/GameState";
import type { MutationType } from "../../../../shared/missionMutation";

export type EncounterBusinessResolution =
  | { kind: "captured"; mutationType: Extract<MutationType, "CAPTURED_PATH"> }
  | {
      kind: "contested";
      mutationType: Extract<MutationType, "RECOVERY_PATH" | "WATCH_WINDOW">;
    }
  | { kind: "closed"; mutationType: Extract<MutationType, "CLOSED_PATH"> }
  | {
      kind: "recovery";
      mutationType: Extract<MutationType, "RECOVERY_PATH" | "ALT_ROUTE">;
    }
  | { kind: "unresolved"; mutationType: null };

/**
 * The sole client-side encounter resolution seam. Its input deliberately has
 * no score/combo/performance fields: only a freshly refetched mission may
 * resolve business truth.
 */
export function projectAuthoritativeOutcome(
  mission: Pick<PlayableMission, "state" | "contestedUntil" | "unlockedPath">
): EncounterBusinessResolution {
  if (mission.state === "captured")
    return { kind: "captured", mutationType: "CAPTURED_PATH" };
  if (mission.state === "closed")
    return { kind: "closed", mutationType: "CLOSED_PATH" };
  if (mission.state === "contested") {
    return {
      kind: "contested",
      mutationType: mission.contestedUntil ? "WATCH_WINDOW" : "RECOVERY_PATH",
    };
  }
  if (
    mission.state === "recovery_active" ||
    mission.state === "recovery_available"
  ) {
    return {
      kind: "recovery",
      mutationType: mission.unlockedPath ? "ALT_ROUTE" : "RECOVERY_PATH",
    };
  }
  return { kind: "unresolved", mutationType: null };
}

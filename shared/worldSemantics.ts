/**
 * Semantic landmark mapping — gives the world a consistent visual vocabulary
 * so a player can read mission intent from silhouette/lighting before reading
 * any text, without inventing new art assets or a dashboard-style UI.
 *
 * This is a pure mapping layer: mission state and archetype already exist as
 * authoritative data (`PlayableMission`, `ObjectionArchetype`); this module
 * only assigns a landmark family and CSS treatment class to what already
 * exists. It does not add new game state.
 */
import type { ObjectionArchetype } from "./salesIntel";
import type { WorldMissionState } from "./driverGameWorld";

export const LANDMARK_FAMILIES = [
  "stronghold",
  "comms_portal",
  "watchtower",
  "gate",
  "signal_beacon",
  "time_shrine",
  "scout_chamber",
  "recovery_path",
  "captured_banner",
] as const;

export type LandmarkFamily = (typeof LANDMARK_FAMILIES)[number];

export type LandmarkTreatment = {
  family: LandmarkFamily;
  /** Short world-native label. Kept compact — the shape carries the meaning. */
  label: string;
  /** CSS class applied to the mission's world icon/path treatment. */
  cssClass: string;
};

/**
 * Terminal/near-terminal states take priority over archetype, since a
 * captured or closed mission is no longer "about" its resistance type.
 */
export function landmarkForMission(input: {
  visualState: WorldMissionState;
  archetype?: ObjectionArchetype;
  /** True for a mission sourced by Expansion Scout rather than the CRM directly. */
  isScoutSourced?: boolean;
}): LandmarkTreatment {
  if (input.visualState === "captured") {
    return { family: "captured_banner", label: "CAPTURED", cssClass: "landmark-captured" };
  }
  if (input.visualState === "closed") {
    return { family: "captured_banner", label: "CLOSED", cssClass: "landmark-closed" };
  }
  if (input.visualState === "recovery_active" || input.visualState === "recovery_available") {
    return { family: "recovery_path", label: "RECOVERY", cssClass: "landmark-recovery" };
  }
  if (input.visualState === "contested") {
    return { family: "watchtower", label: "CONTESTED", cssClass: "landmark-contested" };
  }
  if (input.visualState === "watching") {
    return { family: "watchtower", label: "WATCHING", cssClass: "landmark-watching" };
  }
  if (input.isScoutSourced) {
    return { family: "scout_chamber", label: "SCOUT LEAD", cssClass: "landmark-scout" };
  }

  switch (input.archetype) {
    case "GATEKEEPER":
      return { family: "gate", label: "GATEKEEPER", cssClass: "landmark-gate" };
    case "GHOST":
      return { family: "signal_beacon", label: "GHOST", cssClass: "landmark-beacon" };
    case "STALLER":
      return { family: "time_shrine", label: "STALLER", cssClass: "landmark-shrine" };
    case "ANCHOR":
    default:
      return { family: "stronghold", label: "STRONGHOLD", cssClass: "landmark-stronghold" };
  }
}

/** Channel-family landmark, independent of archetype — used for Cold Call. */
export function landmarkForColdCall(): LandmarkTreatment {
  return { family: "comms_portal", label: "COMMS PORTAL", cssClass: "landmark-comms" };
}

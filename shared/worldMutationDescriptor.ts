/**
 * Semantic world mutation — what an authoritative business outcome MEANS for
 * the environment, expressed independently of how any one corridor draws it.
 *
 * The rule this file exists to enforce structurally, not by convention:
 *
 *     GAME PERFORMANCE CANNOT REACH THIS FUNCTION.
 *
 * `deriveWorldMutation` accepts authoritative business state and authoritative
 * supporting signals. It accepts no score, no combo, no timing grade, no
 * weapon choice, no encounter result. There is therefore no argument a caller
 * could pass to make a perfect run produce a CAPTURED world — the input type
 * simply has nowhere to put it.
 *
 * The second rule, equally structural: a CONTESTED destination does NOT imply
 * a rival. A competitor is rendered only when authoritative data explicitly
 * establishes one. Absent that, contested means "we do not hold this", not
 * "someone else does" — inventing an opponent for visual drama would be
 * fabricating business truth.
 *
 * Corridors consume the descriptor and choose their own treatment, so
 * `captured` is never hardcoded to one tint anywhere in the engine.
 */
import type { WorldMissionState } from "./driverGameWorld";

/** How the gold route itself reads. */
export const ROUTE_TREATMENTS = [
  /** Continuous and settled — the path is held. */
  "stable",
  /** Discontinuous/unstable — progress exists but is not secure. */
  "fractured",
  /** Withdrawing — the path is no longer being pursued. */
  "receding",
  /** A cracked-but-energizing alternate line back in. */
  "recovery",
  /** Ordinary, unremarkable route. */
  "neutral",
] as const;
export type RouteTreatment = (typeof ROUTE_TREATMENTS)[number];

/** How the destination/Stronghold reads. */
export const DESTINATION_TREATMENTS = [
  "illuminated",
  "guarded",
  "dormant",
  "neutral",
] as const;
export type DestinationTreatment = (typeof DESTINATION_TREATMENTS)[number];

/** What the player may physically do at the landmark. */
export const WORLD_AFFORDANCES = ["engage", "recover", "observe", "none"] as const;
export type WorldAffordance = (typeof WORLD_AFFORDANCES)[number];

/**
 * An authoritative, externally-established competitor presence.
 *
 * This type exists so a rival can only ever be rendered from real evidence.
 * There is no way to construct it from gameplay, and `deriveWorldMutation`
 * treats `null` — the default — as "no rival is known", never as "assume one".
 */
export type AuthoritativeCompetitorSignal = {
  /** Where the claim came from; recorded so it can be audited, not guessed. */
  source: "verified_loss_reason" | "recorded_competitor_account";
  /** Stable reference to the evidence establishing the competitor. */
  evidenceReference: string;
};

export type WorldMutationDescriptor = {
  state: WorldMissionState;
  routeTreatment: RouteTreatment;
  destinationTreatment: DestinationTreatment;
  affordance: WorldAffordance;
  /**
   * True ONLY when an authoritative competitor signal was supplied. Corridors
   * must not draw rival imagery on any other basis.
   */
  showsRivalPresence: boolean;
  /**
   * True when the mutation represents a settled, held outcome — corridors may
   * use this to justify permanent-feeling treatment (banners, restoration).
   */
  isSettled: boolean;
};

/**
 * The ONLY input shape. Authoritative state plus authoritative supporting
 * evidence — deliberately nothing else.
 */
export type WorldMutationInput = {
  /** Server-authoritative world state. Never derived from client gameplay. */
  missionState: WorldMissionState;
  /**
   * Authoritative competitor evidence, when it genuinely exists. Omit or pass
   * null whenever it does not — the descriptor will then never claim a rival.
   */
  competitorSignal?: AuthoritativeCompetitorSignal | null;
};

export function deriveWorldMutation(
  input: WorldMutationInput
): WorldMutationDescriptor {
  const { missionState } = input;
  const competitorSignal = input.competitorSignal ?? null;

  // A rival is possible only where the world state could plausibly involve
  // one AND real evidence was supplied. Both conditions are required.
  const rivalRelevant =
    missionState === "contested" ||
    missionState === "closed" ||
    missionState === "recovery_available" ||
    missionState === "recovery_active";
  const showsRivalPresence = rivalRelevant && competitorSignal !== null;

  switch (missionState) {
    case "captured":
      return {
        state: missionState,
        routeTreatment: "stable",
        destinationTreatment: "illuminated",
        affordance: "observe",
        showsRivalPresence: false,
        isSettled: true,
      };

    case "contested":
      return {
        state: missionState,
        routeTreatment: "fractured",
        destinationTreatment: "guarded",
        affordance: "engage",
        showsRivalPresence,
        isSettled: false,
      };

    case "closed":
      return {
        state: missionState,
        routeTreatment: "receding",
        destinationTreatment: "dormant",
        affordance: "none",
        showsRivalPresence,
        isSettled: true,
      };

    case "recovery_available":
    case "recovery_active":
      return {
        state: missionState,
        routeTreatment: "recovery",
        destinationTreatment: "dormant",
        affordance: "recover",
        showsRivalPresence,
        isSettled: false,
      };

    case "watching":
      return {
        state: missionState,
        routeTreatment: "neutral",
        destinationTreatment: "neutral",
        affordance: "observe",
        showsRivalPresence: false,
        isSettled: false,
      };

    case "available":
    case "approaching":
    case "active":
      return {
        state: missionState,
        routeTreatment: "neutral",
        destinationTreatment: "neutral",
        affordance: "engage",
        showsRivalPresence: false,
        isSettled: false,
      };
  }
}

/**
 * States that represent a real, settled business resolution.
 *
 * Used by callers that need to distinguish "the world changed because
 * something actually concluded" from "the world is mid-pursuit". Kept here so
 * the definition lives beside the mutation semantics it belongs to.
 */
export const SETTLED_MISSION_STATES: readonly WorldMissionState[] = [
  "captured",
  "closed",
] as const;

export function isSettledMissionState(state: WorldMissionState): boolean {
  return SETTLED_MISSION_STATES.includes(state);
}

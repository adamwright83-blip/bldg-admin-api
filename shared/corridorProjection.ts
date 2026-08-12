/**
 * Which corridor the player is standing in, derived from real business state.
 *
 * This is the answer to "why am I here?". It is a pure, deterministic
 * projection — the same authoritative state always yields the same corridor,
 * with no randomness, no XP curve, no level counter, and no notion of
 * "unlocking" anything. Goldline does not have levels to pick from; it has
 * real missions that have to be staged somewhere.
 *
 * What this deliberately never does:
 *   - pick a corridor at random
 *   - map an arbitrary progression number to a corridor
 *   - invent a city, neighbourhood, territory or distance
 *   - claim a corridor can host a mission whose capability it never declared
 *
 * Where the state does not justify a specific destination, the projection
 * falls back to the entry corridor and says so, rather than inventing a
 * reason.
 */
import type { MissionSourceType } from "./missionSource";
import type { WorldMissionState } from "./driverGameWorld";

/** ANCHOR/GATEKEEPER/GHOST/STALLER, mirroring the encounter vocabulary. */
export type ProjectionArchetype = "ANCHOR" | "GATEKEEPER" | "GHOST" | "STALLER";

/**
 * Game-native cue vocabulary. Every value here is backed by real state — a
 * reason is only produced when the signal that justifies it actually exists.
 * There is deliberately no "LEVEL N UNLOCKED": no authored level system
 * exists to unlock.
 */
export const CORRIDOR_PROJECTION_REASONS = [
  /** A live field/prospecting signal put this destination in play. */
  "FIELD_SIGNAL",
  /** A relationship with prior evidence re-opened. */
  "RECOVERY_PATH",
  /** Heading to a captured/held destination. */
  "STRONGHOLD_ROUTE",
  /** A freshly sourced discovery. */
  "NEW_SIGNAL",
  /** Nothing more specific is authoritatively known — the entry world. */
  "ROUTE_OPEN",
] as const;

export type CorridorProjectionReason = (typeof CORRIDOR_PROJECTION_REASONS)[number];

/** A corridor as the projection sees it — capability, not artwork. */
export type ProjectableCorridor = {
  id: string;
  playable: boolean;
  capabilities: {
    coldCallPortal: boolean;
    stronghold: boolean;
    missionSources: MissionSourceType[];
  };
};

export type CorridorProjectionInput = {
  /** Where the active mission came from. Null when there is no active mission. */
  missionSource: MissionSourceType | null;
  /** Authoritative world state of the active mission. Null when none. */
  missionState: WorldMissionState | null;
  /** Encounter archetype, when the mission has resolved one. */
  archetype: ProjectionArchetype | null;
  /** Corridors this build knows about, with their declared capabilities. */
  corridors: ProjectableCorridor[];
  /** Corridor to fall back to. Must itself be playable to be used. */
  defaultCorridorId: string;
};

export type CorridorProjection = {
  corridorId: string;
  reason: CorridorProjectionReason;
  /**
   * True when the projection could not justify a specific destination and
   * fell back. Surfaced honestly rather than dressed up as a real signal.
   */
  isFallback: boolean;
};

/**
 * Reason implied by authoritative state alone. Order matters: a captured
 * destination reads as a Stronghold route regardless of which source
 * originally produced it, because that is what the player is walking toward.
 */
function reasonFor(
  missionState: WorldMissionState | null,
  missionSource: MissionSourceType | null
): CorridorProjectionReason | null {
  if (missionState === "captured") return "STRONGHOLD_ROUTE";
  if (
    missionState === "recovery_available" ||
    missionState === "recovery_active" ||
    missionState === "contested"
  ) {
    return "RECOVERY_PATH";
  }
  if (missionSource === "field") return "FIELD_SIGNAL";
  if (missionSource === "scout") return "NEW_SIGNAL";
  if (missionSource === "recovery") return "RECOVERY_PATH";
  return null;
}

/**
 * Corridors able to host this mission, in a stable order.
 *
 * Sorted by id so the choice is reproducible across runs and machines — the
 * determinism the projection promises is only real if the candidate order is
 * also deterministic.
 */
function candidatesFor(
  input: CorridorProjectionInput,
  reason: CorridorProjectionReason | null
): ProjectableCorridor[] {
  const playable = input.corridors
    .filter(corridor => corridor.playable)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  // A Stronghold route requires a corridor that actually has a Stronghold to
  // walk to. Without that capability the corridor cannot stage the arrival.
  if (reason === "STRONGHOLD_ROUTE") {
    const withStronghold = playable.filter(c => c.capabilities.stronghold);
    if (withStronghold.length) return withStronghold;
  }

  if (input.missionSource) {
    const bySource = playable.filter(c =>
      c.capabilities.missionSources.includes(input.missionSource!)
    );
    if (bySource.length) return bySource;
  }

  return playable;
}

/**
 * Projects authoritative state onto a corridor.
 *
 * Deterministic and total: always returns a corridor, always says whether the
 * result was justified by real signal or was a fallback.
 */
export function projectCorridor(input: CorridorProjectionInput): CorridorProjection {
  const reason = reasonFor(input.missionState, input.missionSource);
  const candidates = candidatesFor(input, reason);

  const fallback = (): CorridorProjection => ({
    corridorId: input.defaultCorridorId,
    reason: "ROUTE_OPEN",
    isFallback: true,
  });

  if (!candidates.length) return fallback();

  // With no authoritative reason there is nothing to justify moving the
  // player anywhere specific — stay in the entry world.
  if (reason === null) {
    const defaultIsPlayable = candidates.some(c => c.id === input.defaultCorridorId);
    return defaultIsPlayable
      ? { corridorId: input.defaultCorridorId, reason: "ROUTE_OPEN", isFallback: false }
      : fallback();
  }

  // First candidate in the stable order. Not "best" — there is no scoring
  // here, because inventing a score would be inventing meaning.
  const chosen = candidates[0]!;
  return { corridorId: chosen.id, reason, isFallback: false };
}

/**
 * Player-facing cue for a projection reason.
 *
 * Restrained on purpose: each string states what the world is doing, not a
 * fabricated achievement. Nothing here implies progression, ownership,
 * geography, or a level system.
 */
export function projectionCue(reason: CorridorProjectionReason): string {
  switch (reason) {
    case "FIELD_SIGNAL":
      return "FIELD SIGNAL";
    case "RECOVERY_PATH":
      return "RECOVERY PATH";
    case "STRONGHOLD_ROUTE":
      return "STRONGHOLD ROUTE";
    case "NEW_SIGNAL":
      return "NEW SIGNAL";
    case "ROUTE_OPEN":
      return "ROUTE OPEN";
  }
}

/**
 * Fog — space Goldline has no authoritative playable information about.
 *
 * Explicitly NOT "territory you have not conquered". Fog is an admission of
 * missing information, never a claim about real-world market control, and it
 * therefore carries no geography, no owner, and no competitor.
 */
export type WorldFogCell = {
  corridorId: string;
  known: boolean;
};

/**
 * Reports which known corridors currently have authoritative playable
 * information. A corridor that exists but is unfinished is `known: false` —
 * unknown, not hostile, not owned by anyone.
 */
export function worldFog(corridors: ProjectableCorridor[]): WorldFogCell[] {
  return corridors
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(corridor => ({ corridorId: corridor.id, known: corridor.playable }));
}

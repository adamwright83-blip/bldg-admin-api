import type {
  CorridorAmbientPerson,
  CorridorMissionAnchorPoint,
} from "../../../../shared/corridorManifest";
import type { WorldMissionState } from "../../../../shared/driverGameWorld";
import type { ObjectionArchetype } from "../encounters/EncounterTypes";
import type { MissionAffordanceProjection } from "../encounters/missionAffordance";

export type AuthoritativeMissionForEmbodiment = {
  missionId: number;
  missionKey: string;
  archetype: ObjectionArchetype;
  state: WorldMissionState;
  affordance: MissionAffordanceProjection["primary"];
  worldSignal: MissionAffordanceProjection["worldSignal"];
};

export type MissionEmbodiment = AuthoritativeMissionForEmbodiment & {
  anchorId: string;
  anchor: CorridorMissionAnchorPoint;
  /** Generic interaction role, never a literal-contact identity claim. */
  representation: "generic_role_figure" | "absence_scene";
};

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Binds real mission truth to authored space. A missing/non-authoritative
 * mission produces no person, signal, or affordance. The selected anchor is
 * deterministic and carries no mission data of its own.
 */
export function bindMissionToPopulation(
  mission: AuthoritativeMissionForEmbodiment | null,
  anchors: readonly CorridorMissionAnchorPoint[]
): MissionEmbodiment | null {
  if (
    !mission ||
    !Number.isInteger(mission.missionId) ||
    mission.missionId <= 0
  )
    return null;
  if (anchors.length === 0) return null;
  const anchor = anchors[stableHash(mission.missionKey) % anchors.length];
  return {
    ...mission,
    anchorId: anchor.id,
    anchor,
    representation:
      mission.archetype === "GHOST" ? "absence_scene" : "generic_role_figure",
  };
}

/** Ambient records are presentation-only by construction and never actionable. */
export function ambientPresentation(
  people: readonly CorridorAmbientPerson[]
): Array<{
  id: string;
  behavior: CorridorAmbientPerson["behavior"];
  actionable: false;
  missionId: null;
}> {
  return people.map(person => ({
    id: person.id,
    behavior: person.behavior,
    actionable: false,
    missionId: null,
  }));
}

export function missionDistance(
  embodiment: MissionEmbodiment | null,
  progress: number,
  lateral: number
): number {
  if (!embodiment) return Number.POSITIVE_INFINITY;
  return Math.hypot(
    embodiment.anchor.position.progress - progress,
    (embodiment.anchor.position.lateral - lateral) * 0.35
  );
}

export function isMissionApproachable(
  embodiment: MissionEmbodiment | null,
  progress: number,
  lateral: number
): boolean {
  return (
    missionDistance(embodiment, progress, lateral) <=
    (embodiment?.anchor.stagingRadius ?? 0)
  );
}

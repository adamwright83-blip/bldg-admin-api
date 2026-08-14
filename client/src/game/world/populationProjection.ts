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

/**
 * A genuine pickup/delivery order — never a commercial-mission concept, and
 * never routed through the ANCHOR/GATEKEEPER/GHOST/STALLER sales-encounter
 * archetype system. `orderKey` is only a stable binding key (`order:<id>`);
 * it carries no business fact beyond the real order's own identity.
 */
export type AuthoritativeOrderForEmbodiment = {
  orderId: number;
  orderKey: string;
  kind: "pickup" | "delivery";
  /** Real customer/order label — never fabricated. */
  label: string;
  /**
   * Mirrors the same authoritative payment-eligibility check the canonical
   * delivery mutation already enforces server-side (see
   * `admin.updateStatus`'s payment gate) — presentation-only, never a second
   * truth source. Always false for pickup.
   */
  blocked: boolean;
};

export type OrderEmbodiment = AuthoritativeOrderForEmbodiment & {
  anchorId: string;
  anchor: CorridorMissionAnchorPoint;
};

/**
 * Binds a real order to authored space using the same deterministic
 * anchor-slot mechanism as `bindMissionToPopulation` — presentation only,
 * never a second truth source. `avoidAnchorId` lets the caller keep an
 * order's marker from landing on the same authored slot as the currently
 * embodied commercial mission, when more than one anchor exists.
 */
export function bindOrderToPopulation(
  order: AuthoritativeOrderForEmbodiment | null,
  anchors: readonly CorridorMissionAnchorPoint[],
  avoidAnchorId?: string | null
): OrderEmbodiment | null {
  if (!order || !Number.isInteger(order.orderId) || order.orderId <= 0)
    return null;
  if (anchors.length === 0) return null;
  let index = stableHash(order.orderKey) % anchors.length;
  if (avoidAnchorId && anchors.length > 1 && anchors[index].id === avoidAnchorId) {
    index = (index + 1) % anchors.length;
  }
  const anchor = anchors[index];
  return { ...order, anchorId: anchor.id, anchor };
}

export function orderDistance(
  embodiment: OrderEmbodiment | null,
  progress: number,
  lateral: number
): number {
  if (!embodiment) return Number.POSITIVE_INFINITY;
  return Math.hypot(
    embodiment.anchor.position.progress - progress,
    (embodiment.anchor.position.lateral - lateral) * 0.35
  );
}

export function isOrderApproachable(
  embodiment: OrderEmbodiment | null,
  progress: number,
  lateral: number
): boolean {
  return (
    orderDistance(embodiment, progress, lateral) <=
    (embodiment?.anchor.stagingRadius ?? 0)
  );
}

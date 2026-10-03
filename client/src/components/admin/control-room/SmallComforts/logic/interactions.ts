import type { Item, Layout } from "./grid";
import {
  GUEST_PROFILES,
  guestCapability,
  guestHasTrait,
  itemHasTag,
  type GuestId,
  type GuestNeed,
} from "./content";
import {
  containerFeature,
  containerFeaturesWithTag,
  type ContainerFeature,
} from "./container";

export type InteractionOutcome =
  | "adjacent_action"
  | "use_capability"
  | "walk_and_operate"
  | "stretch_then_walk"
  | "use_container_feature"
  | "use_item"
  | "use_item_pair"
  | "fallback"
  | "blocked"
  | "satisfied";

export interface InteractionTrace {
  need: GuestNeed;
  outcome: InteractionOutcome;
  source: {
    kind: "item" | "container" | "room";
    id: string;
  };
  capabilityId?: string;
  secondaryItemId?: number;
  distance?: number;
  reason?: string;
}

export interface OperableResolution {
  method: "adjacent" | "capability" | "stretch-then-walk" | "walk" | "unreachable";
  trace: InteractionTrace;
}

/**
 * Resolve an operable object without knowing which guest it is.
 * Extended reach is data on the guest profile, not a hard-coded Conductor branch.
 */
export function resolveOperableInteraction(input: {
  guest: GuestId;
  target: Item;
  distance: number;
  walkable: boolean;
  need?: GuestNeed;
}): OperableResolution {
  const need = input.need ?? "darkness";
  if (!itemHasTag(input.target.kind, "operable")) {
    return {
      method: "unreachable",
      trace: {
        need,
        outcome: "blocked",
        source: { kind: "item", id: String(input.target.id) },
        distance: input.distance,
        reason: "target_not_operable",
      },
    };
  }

  if (input.distance <= 1) {
    return {
      method: "adjacent",
      trace: {
        need,
        outcome: "adjacent_action",
        source: { kind: "item", id: String(input.target.id) },
        distance: input.distance,
      },
    };
  }

  const reach = guestCapability(input.guest, "extended_reach");
  if (reach?.maxDistance !== undefined && input.distance <= reach.maxDistance) {
    return {
      method: "capability",
      trace: {
        need,
        outcome: "use_capability",
        source: { kind: "item", id: String(input.target.id) },
        capabilityId: reach.id,
        distance: input.distance,
        reason: "target_within_extended_reach",
      },
    };
  }

  if (!input.walkable) {
    return {
      method: "unreachable",
      trace: {
        need,
        outcome: "blocked",
        source: { kind: "item", id: String(input.target.id) },
        distance: input.distance,
        reason: "no_reachable_operating_position",
      },
    };
  }

  if (input.distance === 2) {
    return {
      method: "stretch-then-walk",
      trace: {
        need,
        outcome: "stretch_then_walk",
        source: { kind: "item", id: String(input.target.id) },
        distance: input.distance,
      },
    };
  }

  return {
    method: "walk",
    trace: {
      need,
      outcome: "walk_and_operate",
      source: { kind: "item", id: String(input.target.id) },
      distance: input.distance,
    },
  };
}

export function resolveContainerNeed(
  guest: GuestId,
  need: "observe_trains",
  layout: Layout
): { feature: ContainerFeature | null; trace: InteractionTrace } {
  const profile = GUEST_PROFILES[guest];
  if (!profile.needs.includes(need)) {
    return {
      feature: null,
      trace: {
        need,
        outcome: "satisfied",
        source: { kind: "room", id: "no_need" },
      },
    };
  }

  const view = containerFeaturesWithTag(layout, "view_outside")[0];
  if (view) {
    return {
      feature: view,
      trace: {
        need,
        outcome: "use_container_feature",
        source: { kind: "container", id: view.id },
        reason: "active_view_opening",
      },
    };
  }

  const latch = containerFeature(layout, "brass_latch");
  return {
    feature: null,
    trace: {
      need,
      outcome: "fallback",
      source: { kind: "container", id: latch?.id ?? "suitcase_shell" },
      reason: "no_view_opening",
    },
  };
}

export function resolveThermalComfort(input: {
  guest: GuestId;
  layout: Layout;
  cover?: Item;
}): InteractionTrace {
  const draft = containerFeaturesWithTag(input.layout, "draft_source")[0];
  const cover = input.cover && itemHasTag(input.cover.kind, "thermal_cover") ? input.cover : undefined;

  if (draft && guestHasTrait(input.guest, "draft_sensitive")) {
    if (cover) {
      return {
        need: "stay_warm",
        outcome: "use_item",
        source: { kind: "item", id: String(cover.id) },
        reason: `insulates_against_${draft.id}`,
      };
    }

    const insulation = guestCapability(input.guest, "self_insulate");
    if (insulation) {
      return {
        need: "stay_warm",
        outcome: "use_capability",
        source: { kind: "container", id: draft.id },
        capabilityId: insulation.id,
        reason: "draft_exposure",
      };
    }

    return {
      need: "stay_warm",
      outcome: "blocked",
      source: { kind: "container", id: draft.id },
      reason: "draft_exposure",
    };
  }

  if (cover) {
    return {
      need: "stay_warm",
      outcome: "use_item",
      source: { kind: "item", id: String(cover.id) },
      reason: "thermal_cover",
    };
  }

  const insulation = guestCapability(input.guest, "self_insulate");
  if (guestHasTrait(input.guest, "cold_natured") && insulation) {
    return {
      need: "stay_warm",
      outcome: "use_capability",
      source: { kind: "room", id: "ambient_chill" },
      capabilityId: insulation.id,
      reason: "cold_natured",
    };
  }

  return {
    need: "stay_warm",
    outcome: "satisfied",
    source: { kind: "room", id: "ambient" },
  };
}

export function resolveReadingComfort(input: {
  guest: GuestId;
  chair?: Item;
  lamp?: Item;
  lampDistance?: number;
}): InteractionTrace {
  if (!guestHasTrait(input.guest, "reader")) {
    return {
      need: "read_comfortably",
      outcome: "satisfied",
      source: { kind: "room", id: "no_need" },
    };
  }

  if (input.chair && itemHasTag(input.chair.kind, "reading_seat") && input.lamp && itemHasTag(input.lamp.kind, "light_source") && (input.lampDistance ?? Infinity) <= 2) {
    return {
      need: "read_comfortably",
      outcome: "use_item_pair",
      source: { kind: "item", id: String(input.chair.id) },
      secondaryItemId: input.lamp.id,
      distance: input.lampDistance,
    };
  }

  return {
    need: "read_comfortably",
    outcome: "fallback",
    source: { kind: "room", id: "improvised_reading" },
    reason: input.chair ? "no_nearby_light" : "no_reading_seat",
  };
}

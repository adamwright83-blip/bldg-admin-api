import type { Item, ItemKind, Layout } from "./grid";

export type ItemTag =
  | "sleep_surface"
  | "soft"
  | "thermal_cover"
  | "insulating"
  | "reading_seat"
  | "seat"
  | "light_source"
  | "operable"
  | "surface"
  | "elevated_surface"
  | "floor_cover";

export type GuestId = "conductor" | "baker" | "reader";

export type GuestTrait =
  | "train_attuned"
  | "light_sensitive"
  | "draft_sensitive"
  | "cold_natured"
  | "reader";

export type GuestNeed =
  | "sleep"
  | "darkness"
  | "observe_trains"
  | "stay_warm"
  | "read_comfortably";

export type CapabilityKind = "extended_reach" | "self_insulate";

export interface GuestCapability {
  id: "umbrella" | "scarf";
  kind: CapabilityKind;
  maxDistance?: number;
}

export interface GuestProfile {
  id: GuestId;
  traits: readonly GuestTrait[];
  needs: readonly GuestNeed[];
  capabilities: readonly GuestCapability[];
}

export interface ItemDefinition {
  kind: ItemKind;
  tags: readonly ItemTag[];
}

export const ITEM_DEFINITIONS: Record<ItemKind, ItemDefinition> = {
  bed: {
    kind: "bed",
    tags: ["sleep_surface", "soft"],
  },
  blanket: {
    kind: "blanket",
    tags: ["thermal_cover", "soft", "insulating"],
  },
  armchair: {
    kind: "armchair",
    tags: ["sleep_surface", "seat", "reading_seat", "soft"],
  },
  lamp: {
    kind: "lamp",
    tags: ["light_source", "operable"],
  },
  table: {
    kind: "table",
    tags: ["surface", "elevated_surface"],
  },
  rug: {
    kind: "rug",
    tags: ["sleep_surface", "soft", "floor_cover"],
  },
};

export const GUEST_PROFILES: Record<GuestId, GuestProfile> = {
  conductor: {
    id: "conductor",
    traits: ["train_attuned", "light_sensitive"],
    needs: ["sleep", "darkness", "observe_trains"],
    capabilities: [{ id: "umbrella", kind: "extended_reach", maxDistance: 2 }],
  },
  baker: {
    id: "baker",
    traits: ["draft_sensitive", "cold_natured"],
    needs: ["sleep", "stay_warm", "darkness"],
    capabilities: [{ id: "scarf", kind: "self_insulate" }],
  },
  reader: {
    id: "reader",
    traits: ["reader", "light_sensitive"],
    needs: ["sleep", "read_comfortably", "darkness"],
    capabilities: [],
  },
};

export function itemHasTag(kind: ItemKind, tag: ItemTag): boolean {
  return ITEM_DEFINITIONS[kind].tags.includes(tag);
}

export function itemsWithTag(layout: Layout, tag: ItemTag): Item[] {
  return layout.items.filter(item => itemHasTag(item.kind, tag));
}

export function guestHasTrait(guest: GuestId, trait: GuestTrait): boolean {
  return GUEST_PROFILES[guest].traits.includes(trait);
}

export function guestCapability(guest: GuestId, kind: CapabilityKind): GuestCapability | undefined {
  return GUEST_PROFILES[guest].capabilities.find(capability => capability.kind === kind);
}

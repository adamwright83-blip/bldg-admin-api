export const COZY_SLOT_IDS = [
  "slot_01",
  "slot_02",
  "slot_03",
  "slot_04",
  "slot_05",
  "slot_06",
  "slot_07",
  "slot_08",
] as const;

export type CozySlotId = (typeof COZY_SLOT_IDS)[number];

export const VILLAGER_VARIANTS = [
  "fox",
  "bear",
  "otter",
  "bunny",
  "squirrel",
  "badger",
  "hedgehog",
  "cat",
] as const;

export type VillagerVariant = (typeof VILLAGER_VARIANTS)[number];

export type VillagerAnimationState =
  | "idle"
  | "wave"
  | "selected"
  | "acknowledged";

export interface SlotAnchor {
  slotId: CozySlotId;
  houseTitle: string;
  roofColor: string;
  /** Normalized X position [0.0, 1.0] on 16:9 canvas */
  x: number;
  /** Normalized Y position [0.0, 1.0] on 16:9 canvas */
  y: number;
  /** Isometric stacking depth */
  zIndex: number;
  defaultVariant: VillagerVariant;
}

export const COZY_SLOT_ANCHORS: Record<CozySlotId, SlotAnchor> = {
  slot_01: {
    slotId: "slot_01",
    houseTitle: "Blue Two-Story Cottage",
    roofColor: "#4A78A6",
    x: 0.31,
    y: 0.4,
    zIndex: 20,
    defaultVariant: "fox",
  },
  slot_02: {
    slotId: "slot_02",
    houseTitle: "Terracotta Timber House",
    roofColor: "#D66938",
    x: 0.41,
    y: 0.36,
    zIndex: 15,
    defaultVariant: "bear",
  },
  slot_03: {
    slotId: "slot_03",
    houseTitle: "Green Lodge & Deck",
    roofColor: "#5B8C61",
    x: 0.6,
    y: 0.38,
    zIndex: 15,
    defaultVariant: "otter",
  },
  slot_04: {
    slotId: "slot_04",
    houseTitle: "Upper Slate-Purple Cottage",
    roofColor: "#7B6B9E",
    x: 0.72,
    y: 0.44,
    zIndex: 25,
    defaultVariant: "squirrel",
  },
  slot_05: {
    slotId: "slot_05",
    houseTitle: "Lower Purple Stone Cottage",
    roofColor: "#7B6B9E",
    x: 0.76,
    y: 0.74,
    zIndex: 45,
    defaultVariant: "badger",
  },
  slot_06: {
    slotId: "slot_06",
    houseTitle: "Teal Garden Cottage",
    roofColor: "#3B7A8C",
    x: 0.55,
    y: 0.81,
    zIndex: 50,
    defaultVariant: "cat",
  },
  slot_07: {
    slotId: "slot_07",
    houseTitle: "Yellow Timber Cottage",
    roofColor: "#E09E38",
    x: 0.48,
    y: 0.81,
    zIndex: 50,
    defaultVariant: "fox",
  },
  slot_08: {
    slotId: "slot_08",
    houseTitle: "Rose Thatched Cottage",
    roofColor: "#D9A873",
    x: 0.24,
    y: 0.72,
    zIndex: 40,
    defaultVariant: "hedgehog",
  },
};

export type CozyConsentStatus =
  | "verified_opt_in"
  | "existing_customer_relationship"
  | "blocked_opt_out"
  | "missing_phone";

export type CozyConsentBasis =
  | "explicit_consent_record"
  | "transactional_dormant_recovery"
  | "opted_out_blocked"
  | "missing_contact_info";

export interface CozyCustomerTarget {
  slotId: CozySlotId;
  customerId: string;
  displayName: string;
  phone: string | null;
  address: string;
  territoryId: string;
  territoryName: string;
  daysSinceLastOrder: number;
  paidOrders: number;
  lifetimeCents: number;
  lastOrderDate: string | null;
  lastOrderSummary: string | null;
  hasConsent: boolean;
  consentStatus: CozyConsentStatus;
  consentBasis: CozyConsentBasis;
  consentReason?: string;
  villagerVariant: VillagerVariant;
  suggestedMessage: string;
  status:
    | "eligible"
    | "draft_ready"
    | "accepted"
    | "consent_blocked"
    | "scheduled"
    | "awaiting_sender_setup";
  providerReceipt?: {
    messageSid: string;
    status: string;
    sentAt: string;
    evidenceName: string;
  };
  scheduledDraft?: {
    messageId: string;
    scheduledFor: string;
    timezone: string;
    currentMessageBody: string;
  };
}

export interface CozyEncounterMission {
  missionId: string;
  title: string;
  objective: string;
  territoryId: string;
  territoryName: string;
  totalLapsedInTerritory: number;
  activeTargetCount: number;
  targets: CozyCustomerTarget[];
}

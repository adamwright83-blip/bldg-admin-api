/**
 * Slice 2 — Kingdom sequence and campaign contracts.
 * See docs/goldline/BUILD_BRIEF_SLICES_1_5.md Slice 2.
 */

export const LANTERN_CITY_STATUSES = ["locked", "active", "complete"] as const;
export type LanternCityStatus = (typeof LANTERN_CITY_STATUSES)[number];

export type GoldlineKingdom = {
  id: string;
  tenantId: string;
  kingdomId: string;
  sequence: number;
  title: string;
  /** null until a real campaign from the library is assigned/selected. */
  realCampaignId: string | null;
  fictionalFieldMission: string;
  lanternCityStatus: LanternCityStatus;
  driverDayRelevance: string;
  /** null until the companion is earned (or, pre-Slice-3, before one is defined at all). */
  companionEarnedId: string | null;
  enablesKingdomId: string | null;
  /** Kingdom 3 §2.4: the companion capability this challenge requires. */
  capabilityRequirement: string | null;
  selectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GoldlineKingdomInput = Omit<
  GoldlineKingdom,
  "id" | "tenantId" | "kingdomId" | "createdAt" | "updatedAt"
>;

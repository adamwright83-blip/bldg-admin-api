/**
 * Slice 1 — growth campaign library types.
 *
 * A campaign is an editable template, never business truth by itself.
 * An `ops_tasks` row (server/opsTasks.ts) is the real instance of doing one
 * on a given day. See docs/goldline/BUILD_BRIEF_SLICES_1_5.md Slice 1.
 *
 * This is the exact field list Slice 4's Mission Director consumes
 * (docs/goldline/SLICE_4_MISSION_DIRECTOR.md §2) plus the two fields that
 * reconcile the library with server/opsTasks.ts and shared/leadHunt.ts.
 */

export const POCKET_KINDS = [
  "between_stops",
  "open_ended",
  "pre_route",
  "post_route",
  "any",
] as const;
export type PocketKind = (typeof POCKET_KINDS)[number];

export const MISSION_CATEGORIES = [
  "territory_expansion",
  "account_acquisition",
  "relationship_capital",
  "reputation",
  "retention",
  "digital_presence",
  "alliance",
] as const;
export type MissionCategory = (typeof MISSION_CATEGORIES)[number];

export type FallbackVariant = {
  title: string;
  completionCondition: string;
  pocketMinutesMin: number;
};

export type TimingAssumption = {
  assumption: string;
  source: string;
  recordedAt: string;
};

export type LegacyContractRef = {
  leadHuntId: string;
};

export type GrowthCampaign = {
  id: string;
  tenantId: string;
  campaignId: string;
  enabled: boolean;
  title: string;
  objective: string;
  completionCondition: string;
  prepLeadDays: number;
  prepCondition: string | null;
  pocketKind: PocketKind;
  pocketMinutesMin: number;
  fallbackVariant: FallbackVariant | null;
  autoVerifiable: string[];
  selfReported: string[];
  missionCategory: MissionCategory;
  companionAbilityId: string | null;
  timingAssumptions: TimingAssumption[];
  opsTaskType: string;
  legacyContract: "lead_hunt" | null;
  legacyContractRef: LegacyContractRef | null;
  createdAt: string;
  updatedAt: string;
};

export type GrowthCampaignInput = Omit<
  GrowthCampaign,
  "id" | "tenantId" | "campaignId" | "createdAt" | "updatedAt"
>;

export type GrowthCampaignPatch = Partial<
  Pick<
    GrowthCampaign,
    | "enabled"
    | "title"
    | "objective"
    | "completionCondition"
    | "prepLeadDays"
    | "prepCondition"
    | "pocketKind"
    | "pocketMinutesMin"
    | "fallbackVariant"
    | "autoVerifiable"
    | "selfReported"
    | "missionCategory"
    | "companionAbilityId"
    | "timingAssumptions"
    | "opsTaskType"
  >
>;

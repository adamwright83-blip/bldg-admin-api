/**
 * Campaign composition — Layer D.
 *
 * A campaign binds already-legitimate Goldline objectives into one adventure.
 * It stores identity, chapter bindings, and revision history. It never copies
 * customer, order, visit, or territory business progress.
 */

import { stableHash } from "./goldlineTerritories";
import type { GoldlineObjective } from "./goldlineAdventure";

export const CAMPAIGN_RULES_VERSION = 1 as const;

export const CAMPAIGN_PHASES = [
  "opening",
  "rising",
  "turn",
  "climax",
  "epilogue",
] as const;
export type CampaignPhase = (typeof CAMPAIGN_PHASES)[number];

export const CAMPAIGN_CHAPTER_KINDS = [
  "hard_anchor",
  "opportunity_corridor",
  "visit_hunt",
  "recovery_branch",
  "follow_up_branch",
  "expedition",
  "territory_push",
  "guardian_finale",
  "open_channel",
  "return_to_stronghold",
] as const;
export type CampaignChapterKind = (typeof CAMPAIGN_CHAPTER_KINDS)[number];

export const GAMEPLAY_BINDINGS = [
  "expedition",
  "authoritative_visit_route",
  "local_target_run",
  "action_grammar",
  "encounter",
  "recovery",
  "territory_push",
  "guardian_finale",
  "field_journal",
  "direct_real_action",
  "world_exploration",
] as const;
export type GameplayBinding = (typeof GAMEPLAY_BINDINGS)[number];

export const CAMPAIGN_ARCHETYPE_IDS = [
  "broken_crown",
  "golden_circuit",
  "ghost_signal",
  "six_doors",
  "last_window",
  "open_sky",
] as const;
export type CampaignArchetypeId = (typeof CAMPAIGN_ARCHETYPE_IDS)[number];

export const CAMPAIGN_STATUSES = ["authored", "active", "completed", "quiet"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_REVISION_REASONS = [
  "NEW_FIXED_COMMITMENT",
  "OBLIGATION_BECAME_DUE",
  "AUTHORITATIVE_ACTION_COMPLETED",
  "TERRITORY_BECAME_READY",
  "ROUTE_WINDOW_CHANGED",
  "REAL_OUTCOME_CHANGED",
  "OPPORTUNITY_NO_LONGER_ELIGIBLE",
] as const;
export type CampaignRevisionReason = (typeof CAMPAIGN_REVISION_REASONS)[number];

export type TerritoryCampaignHint = {
  territoryId: string;
  memberPhysicalEntityIds: readonly string[];
  confrontationReady: boolean;
  cleared: boolean;
};

export type CampaignChapter = {
  stableChapterId: string;
  chapterKind: CampaignChapterKind;
  objectiveIds: string[];
  required: boolean;
  hardAnchor: boolean;
  campaignPhase: CampaignPhase;
  eligibleGameplayBindings: GameplayBinding[];
  selectedGameplayBinding: GameplayBinding;
  territoryId: string | null;
  fictionalTreatment: string;
  fictionTemplateId: string | null;
  physicalAnchors: Array<{
    physicalEntityId: string | null;
    latitude: number | null;
    longitude: number | null;
  }>;
};

export const CAMPAIGN_PACING = [
  "quiet",
  "build",
  "pressure",
  "breather",
  "turn",
  "climax",
] as const;
export type CampaignPacing = (typeof CAMPAIGN_PACING)[number];

export function stableCampaignChapterId(input: {
  businessDate: string;
  chapterKind: CampaignChapterKind;
  objectiveIds: readonly string[];
  territoryId?: string | null;
}): string {
  const members = input.objectiveIds.length
    ? [...input.objectiveIds].sort().join("+")
    : input.territoryId ?? "none";
  return `${input.businessDate}:${input.chapterKind}:${members}`;
}

export type CampaignDraft = {
  tenantId: string;
  operatorId: string;
  businessDate: string;
  rulesVersion: number;
  campaignArchetypeId: CampaignArchetypeId;
  stableKey: string;
  inputFingerprint: string;
  title: string;
  premise: string;
  chapters: CampaignChapter[];
  currentChapterId: string | null;
  completedChapterIds: string[];
  status: CampaignStatus;
  endingTreatment: string | null;
};

export type CampaignRevisionDiff = {
  campaignId: string;
  revision: number;
  inputFingerprint: string;
  reasonCodes: CampaignRevisionReason[];
  addedFutureChapterIds: string[];
  removedFutureChapterIds: string[];
  reorderedFutureChapterIds: string[];
};

export type CampaignInstance = CampaignDraft & {
  id: string;
  revision: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type CampaignPresentation = {
  campaign: CampaignInstance;
  lastRevision: CampaignRevisionDiff | null;
  revisionExplanation: string | null;
  pacing: CampaignPacing;
  conversationSanctuary: boolean;
  travelProviderState: "configured" | "unconfigured" | "unavailable" | "test_stub";
};

export type CampaignCompileInput = {
  tenantId: string;
  operatorId: string;
  businessDate: string;
  objectives: readonly GoldlineObjective[];
  territories?: readonly TerritoryCampaignHint[];
  obligationDue?: boolean;
  priorCampaignTitle?: string | null;
  travelWindowFingerprint?: string | null;
};

export function campaignStableKey(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
  rulesVersion?: number;
}): string {
  const version = input.rulesVersion ?? CAMPAIGN_RULES_VERSION;
  return `campaign:${input.tenantId}:${input.businessDate}:v${version}`;
}

export function campaignInputFingerprint(input: CampaignCompileInput): string {
  const objectives = [...input.objectives]
    .map(
      item =>
        [
          item.id,
          item.status,
          item.authority,
          item.kind,
          item.physicalEntityId ?? "",
          item.windowStart ?? "",
          item.windowEnd ?? "",
        ].join(":")
    )
    .sort();
  const territories = [...(input.territories ?? [])]
    .map(
      item =>
        `${item.territoryId}:${item.confrontationReady ? "1" : "0"}:${item.cleared ? "1" : "0"}:${item.memberPhysicalEntityIds.join(",")}`
    )
    .sort();
  const raw = [
    input.businessDate,
    input.obligationDue ? "obligation" : "clear",
    input.travelWindowFingerprint ?? "travel:unknown",
    ...objectives,
    ...territories,
  ].join("|");
  return `fp:${stableHash(raw).toString(16)}`;
}

export function campaignGameEventContract(input: {
  eventType: string;
  classification: string;
  provenanceClass: string;
}): boolean {
  const allowed = new Set([
    "campaign_published",
    "campaign_started",
    "campaign_revised",
    "campaign_chapter_entered",
    "campaign_branch_chosen",
    "campaign_chapter_game_completed",
    "campaign_completed",
  ]);
  return (
    allowed.has(input.eventType) &&
    input.classification === "game_projection" &&
    input.provenanceClass === "generated_game_fiction"
  );
}

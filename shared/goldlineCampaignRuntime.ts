/**
 * Runtime host for campaign chapters.
 *
 * This is not a second expedition, visit-route, or encounter engine.
 * It names which EXISTING system should present the current chapter.
 */

import type {
  CampaignChapter,
  CampaignPacing,
  CampaignStatus,
  GameplayBinding,
} from "./goldlineCampaign";

export const EXISTING_GAMEPLAY_HOSTS = {
  expedition: "expedition",
  authoritative_visit_route: "authoritative_visit_route",
  local_target_run: "local_target_run",
  action_grammar: "action_grammar_fiction",
  encounter: "encounters",
  recovery: "recovery",
  territory_push: "territories",
  guardian_finale: "guardian_encounter",
  field_journal: "field_voice_journal",
  direct_real_action: "real_action_bridge",
  world_exploration: "overland",
} as const;

export type ExistingGameplayHost =
  (typeof EXISTING_GAMEPLAY_HOSTS)[GameplayBinding];

export function hostForBinding(binding: GameplayBinding): ExistingGameplayHost {
  return EXISTING_GAMEPLAY_HOSTS[binding];
}

export type CampaignHostInvocation = {
  binding: GameplayBinding;
  host: ExistingGameplayHost;
  chapterId: string;
  objectiveIds: readonly string[];
};

export const CAMPAIGN_HOST_SURFACES = [
  "overland",
  "operations",
  "open_channel",
  "field_journal",
  "guardian_encounter",
] as const;
export type CampaignHostSurface = (typeof CAMPAIGN_HOST_SURFACES)[number];

/**
 * Map a chapter's selected binding onto an already-existing driver surface.
 * This does not invent a second expedition or visit-route engine.
 */
export function surfaceForCampaignHost(binding: GameplayBinding): CampaignHostSurface {
  switch (hostForBinding(binding)) {
    case "overland":
    case "territories":
      return "overland";
    case "guardian_encounter":
      return "guardian_encounter";
    case "local_target_run":
      return "open_channel";
    case "field_voice_journal":
      return "field_journal";
    default:
      return "operations";
  }
}

export function campaignWorldRemainsPlayable(status: CampaignStatus): boolean {
  return status === "quiet" || status === "authored" || status === "active" || status === "completed";
}

export function arcadePressureAllowed(input: {
  driving: boolean;
  conversationSanctuary: boolean;
  binding: GameplayBinding;
}): boolean {
  if (input.driving || input.conversationSanctuary) return false;
  return input.binding === "guardian_finale" || input.binding === "encounter";
}

export function deadAirBridgeAllowed(input: {
  pacing: CampaignPacing;
  driving: boolean;
  conversationSanctuary: boolean;
}): boolean {
  if (input.driving || input.conversationSanctuary) return false;
  return input.pacing === "breather" || input.pacing === "build";
}

export type CampaignArrivalPhase = "en_route" | "arriving" | "focal" | "free_roam";

export function campaignArrivalPhase(input: {
  driving: boolean;
  atDestination: boolean;
  status: CampaignStatus;
}): CampaignArrivalPhase {
  if (input.status === "quiet" || input.status === "completed") return "free_roam";
  if (input.atDestination) return "focal";
  if (input.driving) return "en_route";
  return "arriving";
}

export function dayPlanStopMatchesObjective(stopId: string, objectiveId: string): boolean {
  if (stopId === objectiveId) return true;
  const living = stopId.replace(/^living-world-/, "");
  if (living === objectiveId) return true;
  const pickup = objectiveId.match(/^pickup:(.+)$/);
  if (pickup && stopId === `native-pickup-${pickup[1]}`) return true;
  const delivery = objectiveId.match(/^(?:delivery|dropoff):(.+)$/);
  if (delivery && stopId === `native-dropoff-${delivery[1]}`) return true;
  return false;
}

/**
 * Day Plan is a readable projection of the campaign, not a second compiler.
 * Unmatched real stops stay — nothing is invented or dropped.
 */
export function projectStopsOntoCampaign<T extends { id: string }>(
  stops: readonly T[],
  chapters: readonly { objectiveIds: readonly string[] }[]
): T[] {
  if (!chapters.length) return [...stops];
  const rank = new Map<string, number>();
  let cursor = 0;
  for (const chapter of chapters) {
    for (const objectiveId of chapter.objectiveIds) {
      rank.set(objectiveId, cursor);
      cursor += 1;
    }
  }
  return [...stops].sort((a, b) => {
    const aRank = rankForStop(a.id, rank);
    const bRank = rankForStop(b.id, rank);
    return aRank - bRank;
  });
}

function rankForStop(stopId: string, rank: Map<string, number>): number {
  for (const [objectiveId, value] of Array.from(rank.entries())) {
    if (dayPlanStopMatchesObjective(stopId, objectiveId)) return value;
  }
  return Number.MAX_SAFE_INTEGER;
}

export function currentChapterHost(input: {
  chapters: readonly CampaignChapter[];
  currentChapterId: string | null;
}): { chapter: CampaignChapter; binding: GameplayBinding; host: ExistingGameplayHost } | null {
  const chapter = input.chapters.find(item => item.stableChapterId === input.currentChapterId);
  if (!chapter) return null;
  return {
    chapter,
    binding: chapter.selectedGameplayBinding,
    host: hostForBinding(chapter.selectedGameplayBinding),
  };
}

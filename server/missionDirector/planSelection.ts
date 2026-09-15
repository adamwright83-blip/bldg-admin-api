/**
 * Slice 4 §§4-6 — deterministic primary/fallback selection.
 *
 * Ranking is grounded and inspectable. campaignId is the final equal-score
 * tie-break only. LLM availability never changes this function's selection.
 */
import type { GrowthCampaign } from "../campaignLibrary/campaignLibraryTypes";
import type {
  MissionPlanOutcome,
  MissionRankEvidence,
  MissionSelection,
  TimePocket,
} from "./missionDirectorTypes";
import { rankCampaigns, type RankingContext } from "./missionRank";

export const EMPTY_RANKING_CONTEXT: RankingContext = {
  businessDate: "1970-01-01",
  macroGoal: null,
  openTasks: [],
};

function fitsPocket(
  pocketMinutesMin: number,
  pocketKind: GrowthCampaign["pocketKind"],
  pocket: TimePocket
): boolean {
  if (pocketKind !== "any" && pocketKind !== pocket.kind) return false;
  if (pocket.usableMinutes == null) return false;
  return pocket.usableMinutes >= pocketMinutesMin;
}

function bestPocketFor(
  campaign: GrowthCampaign,
  pockets: readonly TimePocket[]
): TimePocket | null {
  const fits = pockets
    .filter(pocket => pocket.confidence === "high")
    .filter(pocket => fitsPocket(campaign.pocketMinutesMin, campaign.pocketKind, pocket));
  if (fits.length === 0) return null;
  return fits.sort((a, b) => (b.usableMinutes ?? 0) - (a.usableMinutes ?? 0))[0];
}

function bestFallbackPocketFor(
  campaign: GrowthCampaign,
  pockets: readonly TimePocket[]
): TimePocket | null {
  if (!campaign.fallbackVariant) return null;
  const fits = pockets.filter(pocket =>
    fitsPocket(campaign.fallbackVariant!.pocketMinutesMin, campaign.pocketKind, pocket)
  );
  if (fits.length === 0) return null;
  return fits.sort((a, b) => (b.usableMinutes ?? 0) - (a.usableMinutes ?? 0))[0];
}

function evidenceFor(
  ranking: readonly MissionRankEvidence[],
  campaignId: string
): MissionRankEvidence {
  return (
    ranking.find(item => item.campaignId === campaignId) ?? {
      campaignId,
      score: 0,
      confidence: "low",
      factors: [],
      warnings: ["Ranking evidence missing for this campaign."],
    }
  );
}

function toFullSelection(
  campaign: GrowthCampaign,
  pocket: TimePocket,
  rankEvidence: MissionRankEvidence
): MissionSelection {
  return {
    campaignId: campaign.campaignId,
    title: campaign.title,
    objective: campaign.objective,
    completionCondition: campaign.completionCondition,
    pocket,
    isFallbackVariant: false,
    rankEvidence,
  };
}

function toFallbackSelection(
  campaign: GrowthCampaign,
  pocket: TimePocket,
  rankEvidence: MissionRankEvidence
): MissionSelection {
  const variant = campaign.fallbackVariant!;
  return {
    campaignId: campaign.campaignId,
    title: variant.title,
    objective: campaign.objective,
    completionCondition: variant.completionCondition,
    pocket,
    isFallbackVariant: true,
    rankEvidence,
  };
}

function byRank(eligible: readonly GrowthCampaign[], ranking: readonly MissionRankEvidence[]) {
  const order = new Map(ranking.map((item, index) => [item.campaignId, index]));
  return [...eligible].sort(
    (a, b) => (order.get(a.campaignId) ?? 999) - (order.get(b.campaignId) ?? 999)
  );
}

export function selectMissionPlan(input: {
  eligible: readonly GrowthCampaign[];
  pockets: readonly TimePocket[];
  libraryTotalCount: number;
  libraryEnabledCount: number;
  rankingContext?: RankingContext;
}): MissionPlanOutcome {
  const ranking = rankCampaigns({
    campaigns: input.eligible,
    context: input.rankingContext ?? EMPTY_RANKING_CONTEXT,
    pockets: input.pockets,
  });
  if (input.libraryTotalCount === 0) {
    return {
      status: "no_plan",
      reason: "CAMPAIGN_LIBRARY_EMPTY",
      remedy: "Add at least one campaign to the growth campaign library.",
      ranking,
    };
  }
  if (input.libraryEnabledCount === 0) {
    return {
      status: "no_plan",
      reason: "ALL_CAMPAIGNS_DISABLED",
      remedy: "Enable at least one campaign in the growth campaign library.",
      ranking,
    };
  }
  if (input.pockets.length === 0) {
    return {
      status: "no_plan",
      reason: "SCHEDULE_DATA_INSUFFICIENT",
      remedy: "Tomorrow's schedule could not be read — check the route/calendar data source.",
      ranking,
    };
  }

  const ordered = byRank(input.eligible, ranking);
  let primaryCampaign: GrowthCampaign | null = null;
  let primaryPocket: TimePocket | null = null;
  for (const campaign of ordered) {
    const pocket = bestPocketFor(campaign, input.pockets);
    if (pocket) {
      primaryCampaign = campaign;
      primaryPocket = pocket;
      break;
    }
  }

  let fallbackCampaign: GrowthCampaign | null = null;
  let fallbackPocket: TimePocket | null = null;
  for (const campaign of ordered) {
    if (campaign.campaignId === primaryCampaign?.campaignId) continue;
    const pocket = bestFallbackPocketFor(campaign, input.pockets);
    if (pocket) {
      fallbackCampaign = campaign;
      fallbackPocket = pocket;
      break;
    }
  }
  if (!fallbackCampaign && primaryCampaign) {
    const pocket = bestFallbackPocketFor(primaryCampaign, input.pockets);
    if (pocket) {
      fallbackCampaign = primaryCampaign;
      fallbackPocket = pocket;
    }
  }

  if (primaryCampaign && primaryPocket && fallbackCampaign && fallbackPocket) {
    return {
      status: "planned",
      primary: toFullSelection(
        primaryCampaign,
        primaryPocket,
        evidenceFor(ranking, primaryCampaign.campaignId)
      ),
      fallback: toFallbackSelection(
        fallbackCampaign,
        fallbackPocket,
        evidenceFor(ranking, fallbackCampaign.campaignId)
      ),
      explanation: "",
      intelligence: "deterministic",
      ranking,
    };
  }

  if (fallbackCampaign && fallbackPocket) {
    const reason = input.pockets.every(pocket => pocket.confidence === "low")
      ? ("POCKET_CONFIDENCE_LOW" as const)
      : ("NO_QUALIFYING_POCKET" as const);
    return {
      status: "fallback_only",
      fallback: toFallbackSelection(
        fallbackCampaign,
        fallbackPocket,
        evidenceFor(ranking, fallbackCampaign.campaignId)
      ),
      reason,
      explanation: "",
      ranking,
    };
  }

  return {
    status: "no_plan",
    reason: "NO_PREPARED_FALLBACK",
    remedy:
      "No enabled campaign has a fallback variant that fits today's available time pockets. Prepare a low-effort fallback for at least one campaign.",
    ranking,
  };
}

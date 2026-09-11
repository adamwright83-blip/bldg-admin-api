/**
 * Slice 4 §§4-6 — deterministic primary/fallback selection.
 *
 * This is the core the intelligence-boundary invariant test guards: with the
 * same campaigns and pockets, this function's output never changes based on
 * whether an LLM is available. Only the surrounding explanation text does.
 */
import type { GrowthCampaign } from "../campaignLibrary/campaignLibraryTypes";
import type {
  MissionPlanOutcome,
  MissionSelection,
  TimePocket,
} from "./missionDirectorTypes";

function fitsPocket(
  pocketMinutesMin: number,
  pocketKind: GrowthCampaign["pocketKind"],
  pocket: TimePocket
): boolean {
  if (pocketKind !== "any" && pocketKind !== pocket.kind) return false;
  if (pocket.usableMinutes == null) return false;
  return pocket.usableMinutes >= pocketMinutesMin;
}

/** Best (largest usableMinutes) high-confidence pocket a campaign's full version fits. */
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

/** Best pocket (any confidence) a campaign's fallback variant fits. */
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

function toFullSelection(campaign: GrowthCampaign, pocket: TimePocket): MissionSelection {
  return {
    campaignId: campaign.campaignId,
    title: campaign.title,
    objective: campaign.objective,
    completionCondition: campaign.completionCondition,
    pocket,
    isFallbackVariant: false,
  };
}

function toFallbackSelection(campaign: GrowthCampaign, pocket: TimePocket): MissionSelection {
  const variant = campaign.fallbackVariant!;
  return {
    campaignId: campaign.campaignId,
    title: variant.title,
    objective: campaign.objective,
    completionCondition: variant.completionCondition,
    pocket,
    isFallbackVariant: true,
  };
}

export function selectMissionPlan(input: {
  eligible: readonly GrowthCampaign[];
  pockets: readonly TimePocket[];
  /** Total campaigns in the library, enabled or not — for CAMPAIGN_LIBRARY_EMPTY vs ALL_CAMPAIGNS_DISABLED. */
  libraryTotalCount: number;
  libraryEnabledCount: number;
}): MissionPlanOutcome {
  if (input.libraryTotalCount === 0) {
    return {
      status: "no_plan",
      reason: "CAMPAIGN_LIBRARY_EMPTY",
      remedy: "Add at least one campaign to the growth campaign library.",
    };
  }
  if (input.libraryEnabledCount === 0) {
    return {
      status: "no_plan",
      reason: "ALL_CAMPAIGNS_DISABLED",
      remedy: "Enable at least one campaign in the growth campaign library.",
    };
  }
  if (input.pockets.length === 0) {
    return {
      status: "no_plan",
      reason: "SCHEDULE_DATA_INSUFFICIENT",
      remedy: "Tomorrow's schedule could not be read — check the route/calendar data source.",
    };
  }

  // Deterministic order (already sorted by eligibility.ts).
  let primaryCampaign: GrowthCampaign | null = null;
  let primaryPocket: TimePocket | null = null;
  for (const campaign of input.eligible) {
    const pocket = bestPocketFor(campaign, input.pockets);
    if (pocket) {
      primaryCampaign = campaign;
      primaryPocket = pocket;
      break;
    }
  }

  let fallbackCampaign: GrowthCampaign | null = null;
  let fallbackPocket: TimePocket | null = null;
  for (const campaign of input.eligible) {
    if (campaign.campaignId === primaryCampaign?.campaignId) continue;
    const pocket = bestFallbackPocketFor(campaign, input.pockets);
    if (pocket) {
      fallbackCampaign = campaign;
      fallbackPocket = pocket;
      break;
    }
  }
  // A campaign may serve as both primary and its own fallback if no other
  // eligible campaign has a fitting fallback variant.
  if (!fallbackCampaign && primaryCampaign) {
    const pocket = bestFallbackPocketFor(primaryCampaign, input.pockets);
    if (pocket) {
      fallbackCampaign = primaryCampaign;
      fallbackPocket = pocket;
    }
  }

  if (primaryCampaign && primaryPocket && fallbackCampaign && fallbackPocket) {
    // fallbackCampaign is always chosen via bestFallbackPocketFor, above —
    // it is always its fallbackVariant, whether it's the primary's own or
    // a different campaign's.
    return {
      status: "planned",
      primary: toFullSelection(primaryCampaign, primaryPocket),
      fallback: toFallbackSelection(fallbackCampaign, fallbackPocket),
      explanation: "",
      intelligence: "deterministic",
    };
  }

  if (fallbackCampaign && fallbackPocket) {
    const reason = input.pockets.every(pocket => pocket.confidence === "low")
      ? ("POCKET_CONFIDENCE_LOW" as const)
      : ("NO_QUALIFYING_POCKET" as const);
    return {
      status: "fallback_only",
      fallback: toFallbackSelection(fallbackCampaign, fallbackPocket),
      reason,
      explanation: "",
    };
  }

  return {
    status: "no_plan",
    reason: "NO_PREPARED_FALLBACK",
    remedy:
      "No enabled campaign has a fallback variant that fits today's available time pockets. Prepare a low-effort fallback for at least one campaign.",
  };
}

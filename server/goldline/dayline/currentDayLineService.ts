/**
 * Today's day-line reader.
 *
 * Ordering authority is system.mission_director (planForDate). This reader
 * projects that ranking and stamps execution type beside it. Execution type
 * is not passed back into the ranker and does not change item order.
 * Weekly primary execution type belongs to Project M.
 */

import { listCampaigns } from "../../campaignLibrary/campaignLibraryService";
import { getDayDirectorState } from "../../dayDirector/dayDirectorService";
import { planForDate } from "../../missionDirector/missionDirectorService";
import type { MissionPlanOutcome } from "../../../shared/missionDirector";
import {
  businessDateInZone,
  projectCurrentDayLine,
  type CurrentDayLine,
  type RankedDayWork,
} from "../../../shared/currentDayLine";

const DEFAULT_TIME_ZONE = "America/Los_Angeles";

type PlanReader = typeof planForDate;
type CampaignReader = typeof listCampaigns;
type DayStateReader = typeof getDayDirectorState;

function rankingOf(outcome: MissionPlanOutcome | null): Array<{ campaignId: string }> {
  if (!outcome || !("ranking" in outcome) || !outcome.ranking) return [];
  return outcome.ranking;
}

export async function readCurrentDayLine(
  input: {
    tenantId: string;
    operatorId: string;
    timeZone?: string;
    now?: Date;
  },
  deps: {
    planForDate?: PlanReader;
    listCampaigns?: CampaignReader;
    getDayDirectorState?: DayStateReader;
  } = {}
): Promise<CurrentDayLine> {
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const now = input.now ?? new Date();
  const businessDate = businessDateInZone(now, timeZone);
  const readPlan = deps.planForDate ?? planForDate;
  const readCampaigns = deps.listCampaigns ?? listCampaigns;
  const readState = deps.getDayDirectorState ?? getDayDirectorState;

  try {
    const [plan, campaigns, state] = await Promise.all([
      readPlan({
        tenantId: input.tenantId,
        operatorId: input.operatorId,
        businessDate,
        timeZone,
      }),
      readCampaigns({ tenantId: input.tenantId, includeDisabled: true }),
      readState({
        tenantId: input.tenantId,
        actorId: input.operatorId,
        businessDate,
      }),
    ]);
    const byCampaign = new Map(campaigns.map(campaign => [campaign.campaignId, campaign]));
    const rankedWorks: RankedDayWork[] = rankingOf(plan.outcome).map(evidence => {
      const campaign = byCampaign.get(evidence.campaignId);
      return {
        id: evidence.campaignId,
        title: campaign?.title ?? "Unspecified work",
        objective: campaign?.objective ?? "",
        completionCondition: campaign?.completionCondition ?? "",
      };
    });
    const primary = state.commitments.find(
      commitment =>
        commitment.status === "open" &&
        commitment.command.role === "primary" &&
        commitment.operatorMission
    );
    const designated = primary
      ? {
          id: primary.id,
          title: primary.title,
          objective: primary.sourceText,
          completionCondition: primary.operatorMission?.completionCondition ?? "",
          compatibilityPhrase: "todays_mission" as const,
        }
      : null;
    return projectCurrentDayLine({
      businessDate,
      rankingStatus: rankedWorks.length ? "ranked" : plan.outcome.status === "no_plan" ? "no_plan" : "ranked",
      rankedWorks,
      designated,
    });
  } catch (error) {
    console.warn(
      "[day-line] today's ranking is unavailable",
      error instanceof Error ? error.message : error
    );
    return projectCurrentDayLine({
      businessDate,
      rankingStatus: "unavailable",
      rankedWorks: [],
      designated: null,
    });
  }
}

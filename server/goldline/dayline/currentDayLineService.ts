/**
 * Today's day-line reader.
 *
 * Ordering authority is system.mission_director (planForDate). This reader
 * projects that ranking and stamps execution type beside it. Execution type
 * is not passed back into the ranker and does not change item order.
 * A no_plan outcome may carry a diagnostic ranking. That ranking is not
 * today's line. Weekly primary execution type belongs to Project M.
 */

import { listCampaigns } from "../../campaignLibrary/campaignLibraryService";
import { getDayDirectorState } from "../../dayDirector/dayDirectorService";
import { getDashboardTimeZone } from "../../dashboardZoned";
import { planForDate } from "../../missionDirector/missionDirectorService";
import type { MissionPlanOutcome } from "../../../shared/missionDirector";
import {
  businessDateInZone,
  projectCurrentDayLine,
  type CurrentDayLine,
  type RankedDayWork,
} from "../../../shared/currentDayLine";

type PlanReader = typeof planForDate;
type CampaignReader = typeof listCampaigns;
type DayStateReader = typeof getDayDirectorState;
type DayState = Awaited<ReturnType<DayStateReader>>;

function rankingOf(outcome: MissionPlanOutcome): Array<{ campaignId: string }> {
  if (outcome.status === "no_plan") return [];
  if (!("ranking" in outcome) || !outcome.ranking) return [];
  return outcome.ranking;
}

function rankingStatusFor(
  outcome: MissionPlanOutcome,
  rankedCount: number
): CurrentDayLine["rankingStatus"] {
  if (outcome.status === "no_plan") return "no_plan";
  if (rankedCount === 0) return "unavailable";
  return "ranked";
}

function operatorDesignation(state: DayState | null): RankedDayWork & {
  compatibilityPhrase: "todays_mission";
} | null {
  if (!state) return null;
  let chosen: DayState["commitments"][number] | null = null;
  for (const commitment of state.commitments) {
    if (commitment.status !== "open" || commitment.command?.role !== "primary") continue;
    if (!commitment.operatorMission) continue;
    const chosenAt = chosen?.command?.designatedAt ?? "";
    const nextAt = commitment.command?.designatedAt ?? "";
    if (!chosen || nextAt > chosenAt) chosen = commitment;
  }
  if (!chosen?.operatorMission) return null;
  return {
    id: chosen.id,
    title: chosen.title,
    objective: chosen.sourceText ?? "",
    completionCondition: chosen.operatorMission.completionCondition,
    compatibilityPhrase: "todays_mission",
  };
}

function unavailableLine(businessDate: string): CurrentDayLine {
  return projectCurrentDayLine({
    businessDate,
    rankingStatus: "unavailable",
    rankedWorks: [],
    designated: null,
  });
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
  const now = input.now ?? new Date();
  const timeZone = input.timeZone?.trim() || getDashboardTimeZone();
  let businessDate: string;
  try {
    businessDate = businessDateInZone(now, timeZone);
  } catch (error) {
    console.warn(
      "[day-line] operator zone is not a business date",
      error instanceof Error ? error.message : error
    );
    return unavailableLine(businessDateInZone(now, "UTC"));
  }

  const tenantId = input.tenantId.trim();
  const operatorId = input.operatorId.trim();
  if (!tenantId || !operatorId || operatorId === "unknown") {
    return unavailableLine(businessDate);
  }

  const readPlan = deps.planForDate ?? planForDate;
  const readCampaigns = deps.listCampaigns ?? listCampaigns;
  const readState = deps.getDayDirectorState ?? getDayDirectorState;

  try {
    const [plan, campaigns] = await Promise.all([
      readPlan({
        tenantId,
        operatorId,
        businessDate,
        timeZone,
      }),
      readCampaigns({ tenantId, includeDisabled: true }),
    ]);
    let state: DayState | null = null;
    try {
      state = await readState({
        tenantId,
        actorId: operatorId,
        businessDate,
      });
    } catch (error) {
      console.warn(
        "[day-line] operator designation is unavailable",
        error instanceof Error ? error.message : error
      );
    }
    const byCampaign = new Map(campaigns.map(campaign => [campaign.campaignId, campaign]));
    const seen = new Set<string>();
    const rankedWorks: RankedDayWork[] = [];
    for (const evidence of rankingOf(plan.outcome)) {
      const id = evidence.campaignId.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const campaign = byCampaign.get(id);
      rankedWorks.push({
        id,
        title: campaign?.title ?? "Unspecified work",
        objective: campaign?.objective ?? "",
        completionCondition: campaign?.completionCondition ?? "",
      });
    }
    return projectCurrentDayLine({
      businessDate,
      rankingStatus: rankingStatusFor(plan.outcome, rankedWorks.length),
      rankedWorks,
      designated: operatorDesignation(state),
    });
  } catch (error) {
    console.warn(
      "[day-line] today's ranking is unavailable",
      error instanceof Error ? error.message : error
    );
    return unavailableLine(businessDate);
  }
}

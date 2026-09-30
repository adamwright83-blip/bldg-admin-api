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
import {
  listGoalCycleObjectives,
  projectToRankedDayWork,
  type PersistentGrowthObjective,
} from "../../persistentOperator/objectiveStore";
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
type ObjectiveReader = typeof listGoalCycleObjectives;
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
  if (outcome.status === "no_plan" && rankedCount === 0) return "no_plan";
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
    lineage: {
      kind: "commitment",
      sourceReference: `day_director_commitments:${chosen.id}`,
      commitmentId: chosen.id,
    },
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

let defaultDayLineDeps: {
  planForDate?: PlanReader;
  listCampaigns?: CampaignReader;
  getDayDirectorState?: DayStateReader;
  listObjectives?: ObjectiveReader;
} = {};

export function setDayLineDepsForTesting(deps: typeof defaultDayLineDeps) {
  defaultDayLineDeps = deps;
}

export function resetDayLineDepsForTesting() {
  defaultDayLineDeps = {};
}

export async function readCurrentDayLine(
  input: {
    tenantId: string;
    operatorId: string;
    operatorIds?: string[];
    operatorUserId?: string;
    operatorUserIds?: string[];
    businessDate?: string;
    timeZone?: string;
    now?: Date;
  },
  deps: {
    planForDate?: PlanReader;
    listCampaigns?: CampaignReader;
    getDayDirectorState?: DayStateReader;
    listObjectives?: ObjectiveReader;
  } = {}
): Promise<CurrentDayLine> {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone?.trim() || getDashboardTimeZone();
  let businessDate = input.businessDate?.trim() || "";
  if (!businessDate) {
    try {
      businessDate = businessDateInZone(now, timeZone);
    } catch (error) {
      console.warn(
        "[day-line] operator zone is not a business date",
        error instanceof Error ? error.message : error
      );
      return unavailableLine(businessDateInZone(now, "UTC"));
    }
  }

  const tenantId = input.tenantId.trim();
  const operatorId = input.operatorId.trim();
  if (!tenantId || !operatorId || operatorId === "unknown") {
    return unavailableLine(businessDate);
  }

  const activeDeps = { ...defaultDayLineDeps, ...deps };
  const readPlan = activeDeps.planForDate ?? planForDate;
  const readCampaigns = activeDeps.listCampaigns ?? listCampaigns;
  const readState = activeDeps.getDayDirectorState ?? getDayDirectorState;
  const readObjectives = activeDeps.listObjectives ?? listGoalCycleObjectives;

  try {
    const [plan, campaigns, objectives] = await Promise.all([
      readPlan({
        tenantId,
        operatorId,
        ...(input.operatorIds?.length ? { operatorIds: input.operatorIds } : {}),
        ...(input.operatorUserId ? { operatorUserId: input.operatorUserId } : {}),
        ...(input.operatorUserIds?.length ? { operatorUserIds: input.operatorUserIds } : {}),
        businessDate,
        timeZone,
      }),
      readCampaigns({ tenantId, includeDisabled: true }),
      readObjectives({
        tenantId,
        businessDate,
      }).catch(err => {
        console.warn(
          "[day-line] persistent objectives are unavailable",
          err instanceof Error ? err.message : err
        );
        return [] as PersistentGrowthObjective[];
      }),
    ]);
    let state: DayState | null = null;
    try {
      state = await readState({
        tenantId,
        actorId: operatorId,
        actorIds: input.operatorIds,
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

    // 1. Persistent Growth Objectives (active operator commitments for today)
    for (const obj of objectives) {
      if (
        obj.status !== "presented" &&
        obj.status !== "accepted" &&
        obj.status !== "in_progress"
      ) {
        continue;
      }
      const work = projectToRankedDayWork(obj);
      if (!work.id || seen.has(work.id)) continue;
      seen.add(work.id);
      work.lineage = {
        kind: "objective",
        sourceReference: `goal_cycle_objectives:${obj.id}`,
        objectiveId: obj.id,
      };
      rankedWorks.push(work);
    }

    // 2. Mission Plan Campaign Ranking
    if (plan.outcome.status !== "no_plan") {
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
          lineage: {
            kind: "campaign",
            sourceReference: `campaign:${id}`,
            campaignId: id,
          },
        });
      }
    }

    // 3. Day Director Commitments
    if (state?.commitments) {
      for (const commitment of state.commitments) {
        if (commitment.status !== "open") continue;
        if (seen.has(commitment.id)) continue;
        if (commitment.command?.role === "primary" && commitment.operatorMission) continue;
        seen.add(commitment.id);
        rankedWorks.push({
          id: commitment.id,
          title: commitment.title,
          objective: commitment.sourceText ?? commitment.title,
          completionCondition: commitment.operatorMission?.completionCondition ?? "Day Director commitment",
          lineage: {
            kind: "commitment",
            sourceReference: `day_director_commitments:${commitment.id}`,
            commitmentId: commitment.id,
          },
        });
      }
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

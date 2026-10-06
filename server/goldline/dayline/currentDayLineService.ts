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

function authoritativeWorkRanking(outcome: MissionPlanOutcome): RankedDayWork[] | null {
  const workPlan = outcome.workPlan;
  if (!workPlan) return null;
  if (workPlan.status !== "ranked") return [];
  return workPlan.ranking
    .filter(item => item.eligible)
    .map(item => ({
      id: item.workId,
      title: item.title,
      objective: item.objective,
      completionCondition: item.completionCondition,
      executionType:
        item.executionType === "mission" || item.executionType === "challenge"
          ? item.executionType
          : null,
      lineage: {
        kind: "candidate" as const,
        sourceReference: `weekly_growth_candidate:${item.workId}`,
        candidateId: item.workId,
      },
    }));
}

function authoritativeRankingStatus(
  outcome: MissionPlanOutcome,
  rankedWorks: readonly RankedDayWork[]
): CurrentDayLine["rankingStatus"] | null {
  const workPlan = outcome.workPlan;
  if (!workPlan) return null;
  if (workPlan.status === "unavailable") return "unavailable";
  if (workPlan.status === "no_eligible_work") return "no_plan";
  return rankedWorks.length > 0 ? "ranked" : "unavailable";
}

function rankingStatusFor(
  outcome: MissionPlanOutcome,
  rankedCount: number
): CurrentDayLine["rankingStatus"] {
  if (outcome.status === "no_plan" && rankedCount === 0) return "no_plan";
  if (rankedCount === 0) return "unavailable";
  return "ranked";
}

function operatorDesignation(
  state: DayState | null,
  outcome?: MissionPlanOutcome,
  rankedWorks: readonly RankedDayWork[] = []
): RankedDayWork & {
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

  // A Mission Director candidate may be the same underlying Day Director
  // commitment under a stable candidate id. Treat source lineage as identity
  // for presentation so the operator does not see the same work twice.
  const workPlan = outcome?.workPlan;
  if (workPlan?.status === "ranked") {
    const rankedCandidate = workPlan.ranking.find(
      item =>
        item.eligible &&
        item.sourceRefs.some(
          ref =>
            ref.sourceType === "day_director_commitment" &&
            ref.sourceId === chosen!.id
        )
    );
    const ranked = rankedCandidate
      ? rankedWorks.find(work => work.id === rankedCandidate.workId) ?? null
      : null;
    if (ranked) {
      return { ...ranked, compatibilityPhrase: "todays_mission" };
    }
  }

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
    const authoritativeWorks = authoritativeWorkRanking(plan.outcome);
    if (authoritativeWorks !== null) {
      return projectCurrentDayLine({
        businessDate,
        rankingStatus:
          authoritativeRankingStatus(plan.outcome, authoritativeWorks) ??
          "unavailable",
        rankedWorks: authoritativeWorks,
        designated: operatorDesignation(state, plan.outcome, authoritativeWorks),
      });
    }

    const byCampaign = new Map(campaigns.map(campaign => [campaign.campaignId, campaign]));
    const seen = new Set<string>();
    const rankedWorks: RankedDayWork[] = [];

    // Compatibility projection for persisted pre-convergence plans only.
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

    // Persistent objectives and Day Director commitments are not appended to
    // a ranked list unless Mission Director ranked their candidate lineage.
    // New plans carry that lineage in workPlan. Old campaign-only plans remain
    // campaign-only; operator designation stays separate below.
    void objectives;
    void state?.commitments;

    return projectCurrentDayLine({
      businessDate,
      rankingStatus: rankingStatusFor(plan.outcome, rankedWorks.length),
      rankedWorks,
      designated: operatorDesignation(state, plan.outcome, rankedWorks),
    });
  } catch (error) {
    console.warn(
      "[day-line] today's ranking is unavailable",
      error instanceof Error ? error.message : error
    );
    return unavailableLine(businessDate);
  }
}

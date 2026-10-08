import { and, desc, eq, inArray } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import {
  legacyDayforgeSaasTenants,
  macroGoalRuns,
  weeklyIntents,
} from "../../drizzle/schema";
import type {
  WeeklyGrowthCandidate,
  WeeklyGrowthCandidateFeed,
} from "../../shared/weeklyGrowthCandidates";
import {
  remainingWeekHorizon,
  targetWeekHorizon,
  type RemainingWeekHorizon,
} from "../../shared/weeklyMissionReadiness";
import { classifyObjectiveExecution, type ObjectiveExecutionType } from "../../shared/objectiveExecution";
import { businessToday } from "../analytics/businessPeriods";
import { getDb } from "../db";
import { selectExecutionIntelligence } from "../executionIntelligence/selectExecutionIntelligence";
import { getLatestPlan } from "../planning/missionDirector/missionDirectorService";
import type { MissionDirectorPlan } from "../../shared/missionDirector";
import type { VerticalRegistry } from "../strategy/verticalTemplates/registry";
import { loadWeeklyGrowthCandidates } from "../weeklyGrowthCandidates/loadWeeklyGrowthCandidates";
import { isLegacyDayforgeTenant } from "../saas/tenantAccess";
import { resolveCanonicalOperatorIdentity } from "./identity";
import {
  appendGoalCycleDecision,
  findDecisionForCycle,
  findPriorComparableDecision,
  type BlockedCycleCandidate,
  type GoalCycleDecisionRecord,
  type GoalCycleSelectionKind,
} from "./decisionStore";
import {
  attachObligationDecisionLineage,
  listOpenPersistentObligations,
  type PersistentObligation,
} from "./obligationStore";
import {
  getGoalCycleObjectiveByDecision,
  materializeGoalCycleObjective,
  type PersistentGrowthObjective,
} from "./objectiveStore";

type CycleChoice = {
  selectionKind: GoalCycleSelectionKind;
  selectedRef: string | null;
  selectedCandidate: WeeklyGrowthCandidate | null;
  selectedObligation: PersistentObligation | null;
  selectedReasonCode: string;
  blockedCandidates: BlockedCycleCandidate[];
};

export function inactiveGoalRunWaitReason(
  status: string
): "GOAL_RUN_COMPLETED" | "GOAL_RUN_INACTIVE" | null {
  if (status === "active") return null;
  return status === "completed" ? "GOAL_RUN_COMPLETED" : "GOAL_RUN_INACTIVE";
}

export function materializedExecutionType(input: {
  authoritative: "mission" | "challenge" | null;
  obligation: ObjectiveExecutionType | null;
  derived: ObjectiveExecutionType | null;
}): ObjectiveExecutionType | null {
  // Current Mission Director workPlan owns the execution classification.
  // Obligation/derived values are compatibility fallbacks only when no
  // authoritative workPlan classification exists.
  return input.authoritative ?? input.obligation ?? input.derived ?? null;
}

function campaignIdFromPlan(
  plan: MissionDirectorPlan | null
): string | null {
  if (!plan) return null;
  if (plan.outcome.status === "planned") return plan.outcome.primary.campaignId;
  if (plan.outcome.status === "fallback_only") return plan.outcome.fallback.campaignId;
  return null;
}

function workPlanFromPlan(plan: MissionDirectorPlan | null) {
  return plan?.outcome.workPlan ?? null;
}


function obligationFromCandidate(
  candidate: WeeklyGrowthCandidate,
  obligations: readonly PersistentObligation[]
): PersistentObligation | null {
  const ids = new Set(
    candidate.sourceRefs
      .filter(ref => ref.sourceKind === "proactive_obligation")
      .map(ref => ref.sourceId)
  );
  return obligations.find(item => ids.has(item.id)) ?? null;
}

function candidateMatchesCampaign(
  candidate: WeeklyGrowthCandidate,
  campaignId: string
): boolean {
  return candidate.sourceRefs.some(
    ref => ref.sourceKind === "campaign_library" && ref.sourceId === campaignId
  );
}

/**
 * Pure PR4 selection. It does not invent ranking. Mission Director's persisted
 * primary is the only source that may turn an eligible feed candidate into a
 * selected candidate here. Candidate-feed array order carries no business
 * priority.
 */
export function selectDeterministicCycleChoice(input: {
  weeklyIntentLocked: boolean;
  candidates: readonly WeeklyGrowthCandidate[];
  obligations: readonly PersistentObligation[];
  dueObligations?: readonly PersistentObligation[];
  missionDirectorPlan: MissionDirectorPlan | null;
}): CycleChoice {
  const workPlan = workPlanFromPlan(input.missionDirectorPlan);
  const blockedCandidates: BlockedCycleCandidate[] = workPlan
    ? workPlan.ranking
        .filter(item => !item.eligible)
        .map(item => ({
          id: item.workId,
          reasons: item.blockedReasons.length
            ? [...item.blockedReasons]
            : ["MISSION_DIRECTOR_BLOCKED"],
        }))
    : input.candidates
        .filter(candidate => !candidate.prep.feasibleWithinHorizon)
        .map(candidate => ({
          id: candidate.id,
          reasons: ["INSUFFICIENT_PREP"],
        }));

  if (workPlan) {
    if (workPlan.status === "unavailable") {
      return {
        selectionKind: "wait",
        selectedRef: null,
        selectedCandidate: null,
        selectedObligation: null,
        selectedReasonCode: "MISSION_DIRECTOR_UNAVAILABLE",
        blockedCandidates,
      };
    }
    if (workPlan.status === "no_eligible_work") {
      return {
        selectionKind: "wait",
        selectedRef: null,
        selectedCandidate: null,
        selectedObligation: null,
        selectedReasonCode: "MISSION_DIRECTOR_NO_ELIGIBLE_WORK",
        blockedCandidates,
      };
    }

    const selected = input.candidates.find(
      candidate => candidate.id === workPlan.primary.workId
    ) ?? null;
    if (!selected) {
      return {
        selectionKind: "wait",
        selectedRef: null,
        selectedCandidate: null,
        selectedObligation: null,
        selectedReasonCode: "MISSION_DIRECTOR_PRIMARY_NOT_IN_FEED",
        blockedCandidates,
      };
    }
    const obligation = obligationFromCandidate(selected, input.obligations);
    return {
      selectionKind: obligation ? "obligation" : "candidate",
      selectedRef: obligation?.id ?? selected.id,
      selectedCandidate: selected,
      selectedObligation: obligation,
      selectedReasonCode: "MISSION_DIRECTOR_PRIMARY",
      blockedCandidates,
    };
  }

  // Compatibility for persisted pre-convergence plans only. New plans always
  // carry workPlan. WeeklyIntent may withhold old candidate plans, but it does
  // not rank or select current work.
  if (!input.weeklyIntentLocked) {
    return {
      selectionKind: "wait",
      selectedRef: null,
      selectedCandidate: null,
      selectedObligation: null,
      selectedReasonCode: "WEEKLY_INTENT_UNPLANNED",
      blockedCandidates: input.candidates.map(candidate => ({
        id: candidate.id,
        reasons: ["WEEK_UNPLANNED_NEW_OBJECTIVE_WITHHELD"],
      })),
    };
  }

  const eligible = input.candidates.filter(
    candidate => candidate.prep.feasibleWithinHorizon
  );
  const campaignId = campaignIdFromPlan(input.missionDirectorPlan);
  const selected = campaignId
    ? eligible.find(candidate =>
        candidateMatchesCampaign(candidate, campaignId)
      ) ?? null
    : null;
  if (selected) {
    const obligation = obligationFromCandidate(selected, input.obligations);
    return {
      selectionKind: obligation ? "obligation" : "candidate",
      selectedRef: obligation?.id ?? selected.id,
      selectedCandidate: selected,
      selectedObligation: obligation,
      selectedReasonCode: "MISSION_DIRECTOR_PRIMARY",
      blockedCandidates,
    };
  }

  return {
    selectionKind: "wait",
    selectedRef: null,
    selectedCandidate: null,
    selectedObligation: null,
    selectedReasonCode: "NO_AUTHORITATIVE_PLAN",
    blockedCandidates,
  };
}

async function tenantTimeZone(tenantId: string): Promise<string | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [tenant] = await db
    .select({ timeZone: legacyDayforgeSaasTenants.timeZone })
    .from(legacyDayforgeSaasTenants)
    .where(eq(legacyDayforgeSaasTenants.id, tenantId))
    .limit(1);
  if (tenant?.timeZone?.trim()) {
    return tenant.timeZone.trim();
  }
  if (isLegacyDayforgeTenant(tenantId)) {
    return process.env.ADMIN_DASHBOARD_TIMEZONE ?? "America/Los_Angeles";
  }
  return null;
}

async function loadRun(input: { tenantId: string; runId: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [run] = await db
    .select()
    .from(macroGoalRuns)
    .where(
      and(
        eq(macroGoalRuns.tenantId, input.tenantId),
        eq(macroGoalRuns.id, input.runId)
      )
    )
    .limit(1);
  if (!run) throw new Error("Macro goal run not found");
  return run;
}

async function latestApplicableWeeklyIntent(input: {
  tenantId: string;
  operatorIds: readonly string[];
  businessDate: string;
  localTime: string;
  weekStart: string;
}): Promise<{
  id: string;
  revision: number;
  weekStart: string;
  horizon: RemainingWeekHorizon;
} | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select({
      id: weeklyIntents.id,
      revision: weeklyIntents.revision,
      weekStart: weeklyIntents.weekStart,
      lockedAt: weeklyIntents.lockedAt,
    })
    .from(weeklyIntents)
    .where(
      and(
        eq(weeklyIntents.tenantId, input.tenantId),
        inArray(weeklyIntents.operatorId, [...input.operatorIds]),
        eq(weeklyIntents.weekStart, input.weekStart)
      )
    )
    .orderBy(desc(weeklyIntents.lockedAt), desc(weeklyIntents.revision))
    .limit(1);
  if (!row) return null;
  const horizon = targetWeekHorizon({
    businessDate: input.businessDate,
    localTime: input.localTime,
    weekStart: row.weekStart,
  });
  if (!horizon.remainingDates.length) return null;
  return {
    id: row.id,
    revision: row.revision,
    weekStart: row.weekStart,
    horizon,
  };
}

function candidateReasonCodes(
  feed: WeeklyGrowthCandidateFeed | null
): Record<string, string[]> {
  return Object.fromEntries(
    (feed?.candidates ?? []).map(candidate => [
      candidate.id,
      [...candidate.rankReasons],
    ])
  );
}

function evidenceReferences(input: {
  weeklyIntentId: string | null;
  plan: MissionDirectorPlan | null;
  candidate: WeeklyGrowthCandidate | null;
  obligation: PersistentObligation | null;
}): string[] {
  const refs = new Set<string>();
  if (input.weeklyIntentId) refs.add(`weekly_intent:${input.weeklyIntentId}`);
  if (input.plan) {
    refs.add(
      `mission_director_plan:${input.plan.id}:revision:${input.plan.revision}`
    );
  }
  for (const ref of input.candidate?.sourceRefs ?? []) {
    refs.add(`${ref.sourceType}:${ref.sourceId}`);
  }
  if (input.obligation) refs.add(`obligation:${input.obligation.id}`);
  return [...refs];
}

export type DecideGoalCycleResult = {
  decision: GoalCycleDecisionRecord;
  created: boolean;
  objective?: PersistentGrowthObjective | null;
};

export async function decideGoalCycle(input: {
  tenantId: string;
  runId: string;
  cycleId: string;
  registry: VerticalRegistry;
  now?: Date;
}): Promise<DecideGoalCycleResult> {
  const existing = await findDecisionForCycle({
    tenantId: input.tenantId,
    cycleId: input.cycleId,
  });
  if (existing) {
    if (existing.selectionKind === "obligation" && existing.selectedRef) {
      await attachObligationDecisionLineage({
        tenantId: input.tenantId,
        obligationId: existing.selectedRef,
        canonicalOperatorId: existing.canonicalOperatorId,
        goalRunId: existing.goalRunId,
        cycleId: existing.cycleId,
        decisionId: existing.id,
        executionType: existing.selectedExecutionType,
        onlyIfUnclaimedOrSameDecision: true,
      });
    }
    const existingObjective =
      existing.selectionKind !== "wait"
        ? await getGoalCycleObjectiveByDecision({
            tenantId: input.tenantId,
            decisionId: existing.id,
          })
        : null;
    return { decision: existing, created: false, objective: existingObjective };
  }

  const now = input.now ?? new Date();
  const run = await loadRun({ tenantId: input.tenantId, runId: input.runId });
  const identity = await resolveCanonicalOperatorIdentity({
    tenantId: input.tenantId,
    source: { type: "open_id", value: run.operatorUserId },
    subsystem: "persistent_operator.goal_cycle_decision",
  });
  if (!identity.ok) {
    throw new Error(`Goal cycle operator identity unresolved: ${identity.reason}`);
  }
  if (identity.identity.canonicalOperatorId !== run.canonicalOperatorId) {
    throw new Error("Goal cycle canonical operator identity changed");
  }

  const operatorIds = [
    identity.identity.canonicalOpenId,
    ...identity.identity.aliases.map(alias => alias.openId),
  ];

  const inactiveRunReason = inactiveGoalRunWaitReason(run.status);
  if (inactiveRunReason) {
    const completed = inactiveRunReason === "GOAL_RUN_COMPLETED";
    const decisionResult = await appendGoalCycleDecision({
      tenantId: input.tenantId,
      goalRunId: run.id,
      cycleId: input.cycleId,
      canonicalOperatorId: run.canonicalOperatorId,
      operatorUserId: run.operatorUserId,
      policyVersion: run.policyVersion,
      weeklyIntentId: null,
      weeklyIntentRevision: null,
      weekStart: null,
      candidateFingerprint: null,
      candidateIds: [],
      candidateReasonCodes: {},
      missionDirectorPlanId: null,
      missionDirectorRevision: null,
      selectionKind: "wait",
      selectedRef: null,
      selectedExecutionType: null,
      selectedReasonCode: inactiveRunReason,
      evidenceRefs:
        completed && run.completionEvidenceRef
          ? [`goal_completion:${run.completionEvidenceRef}`]
          : [],
      blockedCandidates: [],
      priorComparableDecisionId: null,
      sourceCoverage: { goalRun: run.status },
      loadout: [],
      experiment: null,
    });
    return { ...decisionResult, objective: null };
  }

  const timeZone = await tenantTimeZone(input.tenantId);
  if (!timeZone) {
    const draft = {
      tenantId: input.tenantId,
      goalRunId: run.id,
      cycleId: input.cycleId,
      canonicalOperatorId: run.canonicalOperatorId,
      operatorUserId: run.operatorUserId,
      policyVersion: run.policyVersion,
      weeklyIntentId: null,
      weeklyIntentRevision: null,
      weekStart: null,
      candidateFingerprint: null,
      candidateIds: [],
      candidateReasonCodes: {},
      missionDirectorPlanId: null,
      missionDirectorRevision: null,
      selectionKind: "wait" as const,
      selectedRef: null,
      selectedExecutionType: null,
      selectedReasonCode: "TENANT_TIMEZONE_UNAVAILABLE",
      evidenceRefs: [],
      blockedCandidates: [],
      priorComparableDecisionId: null,
      sourceCoverage: { tenantTimeZone: "unavailable" },
      loadout: [],
      experiment: null,
    };
    const decisionResult = await appendGoalCycleDecision(draft);
    return { ...decisionResult, objective: null };
  }

  const today = businessToday(now, timeZone);
  const localTime = formatInTimeZone(now, timeZone, "HH:mm");
  const currentHorizon = remainingWeekHorizon({
    businessDate: today,
    localTime,
  });
  const weeklyIntent = await latestApplicableWeeklyIntent({
    tenantId: input.tenantId,
    operatorIds,
    businessDate: today,
    localTime,
    weekStart: currentHorizon.weekStart,
  });
  const horizon = weeklyIntent?.horizon ?? currentHorizon;

  let feed: WeeklyGrowthCandidateFeed | null = null;
  let feedCoverage: unknown = { status: "unavailable", reason: "not_loaded" };
  try {
    feed = await loadWeeklyGrowthCandidates({
      tenantId: input.tenantId,
      operatorUserId: identity.identity.canonicalOpenId,
      operatorUserIds: operatorIds,
      dayDirectorActorId: identity.identity.dayDirectorActorId,
      dayDirectorActorIds: identity.identity.dayDirectorActorIds,
      remainingDates: horizon.remainingDates,
      now,
      timeZone,
    });
    feedCoverage = { status: "available", sources: feed.sources };
  } catch (error) {
    feedCoverage = {
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const openObligations = await listOpenPersistentObligations({
    tenantId: input.tenantId,
    operatorUserIds: operatorIds,
    verticalKey: run.verticalKey,
    registry: input.registry,
  });
  const dueObligations = openObligations.filter(ob => ob.dueDate <= today);
  const obligationCoverage = {
    status: "available",
    count: openObligations.length,
    dueCount: dueObligations.length,
  };

  let plan: MissionDirectorPlan | null = null;
  let missionDirectorCoverage: unknown = { status: "available", plan: false };
  try {
    plan = await getLatestPlan({
      tenantId: input.tenantId,
      operatorId: identity.identity.weeklyOperatorId,
      operatorIds,
      businessDate: today,
    });
    missionDirectorCoverage = { status: "available", plan: plan !== null };
  } catch (error) {
    missionDirectorCoverage = {
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const sourceCoverage = {
    tenantTimeZone: { status: "available", timeZone },
    weeklyIntent: {
      status: weeklyIntent ? "locked" : "unplanned",
      id: weeklyIntent?.id ?? null,
      revision: weeklyIntent?.revision ?? null,
    },
    candidateFeed: feedCoverage,
    obligations: obligationCoverage,
    missionDirector: missionDirectorCoverage,
    actionPolicy: { status: "not_applicable", reason: "no_machine_action_selected_in_pr4" },
    channelReadiness: { status: "not_applicable", reason: "no_machine_action_selected_in_pr4" },
  };

  const choice = selectDeterministicCycleChoice({
    weeklyIntentLocked: weeklyIntent !== null,
    candidates: feed?.candidates ?? [],
    obligations: openObligations,
    dueObligations,
    missionDirectorPlan: plan,
  });

  const execution =
    choice.selectedCandidate
      ? classifyObjectiveExecution({
          contract: choice.selectedCandidate.objective,
          title: choice.selectedCandidate.title,
        })
      : null;
  const authoritativeExecutionType =
    plan?.outcome.workPlan?.status === "ranked" &&
    choice.selectedCandidate?.id === plan.outcome.workPlan.primary.workId
      ? plan.outcome.workPlan.primary.executionType
      : null;
  const selectedExecutionType = materializedExecutionType({
    authoritative: authoritativeExecutionType,
    obligation: choice.selectedObligation?.executionType ?? null,
    derived: execution?.executionType ?? null,
  });

  const loadout =
    choice.selectionKind === "candidate" && choice.selectedCandidate
      ? await selectExecutionIntelligence({
          tenantId: input.tenantId,
          objectiveRef: {
            objectiveId: choice.selectedCandidate.id,
            executionType: selectedExecutionType,
          },
          context: {
            candidate: choice.selectedCandidate,
            missionDirectorPlan: plan?.outcome ?? null,
            weekStart: weeklyIntent?.weekStart ?? null,
          },
          limit: 3,
        })
      : [];

  const prior = await findPriorComparableDecision({
    tenantId: input.tenantId,
    goalRunId: run.id,
    selectionKind: choice.selectionKind,
    selectedRef: choice.selectedRef,
    excludeCycleId: input.cycleId,
  });

  const persisted = await appendGoalCycleDecision({
    tenantId: input.tenantId,
    goalRunId: run.id,
    cycleId: input.cycleId,
    canonicalOperatorId: run.canonicalOperatorId,
    operatorUserId: run.operatorUserId,
    policyVersion: run.policyVersion,
    weeklyIntentId: weeklyIntent?.id ?? null,
    weeklyIntentRevision: weeklyIntent?.revision ?? null,
    weekStart: weeklyIntent?.weekStart ?? null,
    candidateFingerprint: feed?.fingerprint ?? null,
    candidateIds: (feed?.candidates ?? []).map(candidate => candidate.id),
    candidateReasonCodes: candidateReasonCodes(feed),
    missionDirectorPlanId: plan?.id ?? null,
    missionDirectorRevision: plan?.revision ?? null,
    selectionKind: choice.selectionKind,
    selectedRef: choice.selectedRef,
    selectedExecutionType,
    selectedReasonCode: choice.selectedReasonCode,
    evidenceRefs: evidenceReferences({
      weeklyIntentId: weeklyIntent?.id ?? null,
      plan,
      candidate: choice.selectedCandidate,
      obligation: choice.selectedObligation,
    }),
    blockedCandidates: choice.blockedCandidates,
    priorComparableDecisionId: prior?.id ?? null,
    sourceCoverage,
    loadout,
    experiment: null,
  });

  let objective: PersistentGrowthObjective | null = null;
  if (persisted.decision.selectionKind !== "wait") {
    const materialized = await materializeGoalCycleObjective({
      tenantId: input.tenantId,
      decision: persisted.decision,
      candidate: choice.selectedCandidate,
      obligation: choice.selectedObligation,
      businessDate: today,
      now,
    });
    objective = materialized.objective;
  }

  if (choice.selectedObligation) {
    await attachObligationDecisionLineage({
      tenantId: input.tenantId,
      obligationId: choice.selectedObligation.id,
      canonicalOperatorId: run.canonicalOperatorId,
      goalRunId: run.id,
      cycleId: input.cycleId,
      decisionId: persisted.decision.id,
      executionType: selectedExecutionType,
      objectiveRef:
        objective?.id ??
        choice.selectedCandidate?.id ??
        choice.selectedObligation.objectiveRef ??
        null,
      onlyIfUnclaimedOrSameDecision: true,
    });
  }

  return { decision: persisted.decision, created: persisted.created, objective };
}

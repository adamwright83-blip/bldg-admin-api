import { classifyObjectiveExecution } from "../../shared/objectiveExecution";
import {
  motionAlignsWithMacroGoal,
  type WeeklyGrowthCandidate,
} from "../../shared/weeklyGrowthCandidates";
import type {
  MissionAuthoritativeWorkPlan,
  MissionWorkRankEvidence,
  MissionWorkSelection,
  RankFactor,
  TimePocket,
} from "../../shared/missionDirector";
import type { GrowthCampaign } from "../campaignLibrary/campaignLibraryTypes";
import type { RankingContext, RankingOpenTask } from "./missionRank";

const PRIORITY_EFFECT: Record<RankingOpenTask["priority"], number> = {
  emergency: 400,
  high: 300,
  normal: 100,
  low: 40,
};

function factor(
  name: string,
  value: RankFactor["value"],
  source: string,
  effect: number,
  confidence: RankFactor["confidence"]
): RankFactor {
  return { name, value, source, effect, confidence };
}

function signalNumber(candidate: WeeklyGrowthCandidate, label: string): number | null {
  const signal = candidate.observedSignals.find(item => item.label === label);
  if (!signal) return null;
  const value = Number(signal.value);
  return Number.isFinite(value) ? value : null;
}

function campaignFor(
  candidate: WeeklyGrowthCandidate,
  campaigns: readonly GrowthCampaign[]
): GrowthCampaign | null {
  const ids = new Set(
    candidate.sourceRefs
      .filter(ref => ref.sourceKind === "campaign_library")
      .map(ref => ref.sourceId)
  );
  return campaigns.find(campaign => ids.has(campaign.campaignId)) ?? null;
}

function candidateSourceIds(candidate: WeeklyGrowthCandidate): Set<string> {
  return new Set([
    candidate.id,
    ...candidate.sourceRefs.map(ref => ref.sourceId),
  ]);
}

function matchingOpenTasks(
  candidate: WeeklyGrowthCandidate,
  campaign: GrowthCampaign | null,
  context: RankingContext
): RankingOpenTask[] {
  const ids = candidateSourceIds(candidate);
  return context.openTasks.filter(task => {
    if (task.id && ids.has(task.id)) return true;
    return Boolean(campaign && task.taskType === campaign.opsTaskType);
  });
}

function highestPriority(tasks: readonly RankingOpenTask[]): RankingOpenTask["priority"] | null {
  let highest: RankingOpenTask["priority"] | null = null;
  for (const task of tasks) {
    if (!highest || PRIORITY_EFFECT[task.priority] > PRIORITY_EFFECT[highest]) {
      highest = task.priority;
    }
  }
  return highest;
}

function pocketMatches(
  candidate: WeeklyGrowthCandidate,
  pocket: TimePocket
): boolean {
  const kind = candidate.fit.pocketKind;
  return kind == null || kind === "any" || kind === pocket.kind;
}

function bestKnownPocket(
  candidate: WeeklyGrowthCandidate,
  pockets: readonly TimePocket[]
): TimePocket | null {
  const minimum = candidate.fit.minimumMinutes;
  if (minimum == null || minimum <= 0) return null;
  const fitting = pockets
    .filter(pocket => pocketMatches(candidate, pocket))
    .filter(
      pocket =>
        pocket.confidence === "high" &&
        pocket.usableMinutes != null &&
        pocket.usableMinutes >= minimum
    )
    .sort(
      (a, b) =>
        (b.usableMinutes ?? 0) - (a.usableMinutes ?? 0)
    );
  return fitting[0] ?? null;
}

function protectedPrimaryMatches(
  candidate: WeeklyGrowthCandidate,
  protectedSourceIds: ReadonlySet<string>
): boolean {
  if (protectedSourceIds.size === 0) return false;
  if (protectedSourceIds.has(candidate.id)) return true;
  return candidate.sourceRefs.some(ref => protectedSourceIds.has(ref.sourceId));
}

function rankOne(input: {
  candidate: WeeklyGrowthCandidate;
  campaigns: readonly GrowthCampaign[];
  campaignPrepReady: Readonly<Record<string, boolean>>;
  context: RankingContext;
  pockets: readonly TimePocket[];
  executionConstraint: "mission" | "challenge" | null;
  protectDiscretionary: boolean;
  protectedSourceIds: ReadonlySet<string>;
}): MissionWorkRankEvidence {
  const candidate = input.candidate;
  const campaign = campaignFor(candidate, input.campaigns);
  const completionCondition = campaign?.completionCondition ?? null;
  const execution = classifyObjectiveExecution({
    contract: completionCondition ?? candidate.objective,
    title: candidate.title,
    objective: candidate.objective,
  });
  const factors: RankFactor[] = [];
  const warnings: string[] = [];
  const blockedReasons: string[] = [];

  if (!candidate.prep.feasibleWithinHorizon) {
    blockedReasons.push("INSUFFICIENT_PREP");
  }
  if (
    campaign &&
    !candidate.alreadyInFlight &&
    input.campaignPrepReady[campaign.campaignId] === false
  ) {
    blockedReasons.push("PREP_NOT_READY");
  }

  if (execution.executionType == null) {
    blockedReasons.push("EXECUTION_TYPE_UNKNOWN");
  } else if (execution.executionType === "hybrid_objective") {
    blockedReasons.push("HYBRID_REQUIRES_ACTIONABLE_PHASE");
  } else if (
    input.executionConstraint &&
    execution.executionType !== input.executionConstraint
  ) {
    blockedReasons.push("EXECUTION_CLASS_UNAVAILABLE");
  }

  if (
    input.protectDiscretionary &&
    !protectedPrimaryMatches(candidate, input.protectedSourceIds)
  ) {
    blockedReasons.push("DISCRETIONARY_TIME_PROTECTED");
  }

  const knownPocket = bestKnownPocket(candidate, input.pockets);
  if (
    candidate.fit.minimumMinutes != null &&
    candidate.fit.minimumMinutes > 0 &&
    !knownPocket
  ) {
    blockedReasons.push("NO_QUALIFYING_POCKET");
  }

  const openTasks = matchingOpenTasks(candidate, campaign, input.context);
  const priority = highestPriority(openTasks);
  if (priority) {
    factors.push(
      factor(
        "explicit_operator_priority",
        priority,
        "ops_tasks.priority matched by candidate lineage",
        PRIORITY_EFFECT[priority],
        "high"
      )
    );
  } else {
    factors.push(
      factor(
        "explicit_operator_priority",
        null,
        "no candidate-lineage operator priority",
        0,
        "unknown"
      )
    );
  }

  factors.push(
    factor(
      "continuity_unfinished_work",
      candidate.alreadyInFlight,
      "weekly_growth_candidate.alreadyInFlight",
      candidate.alreadyInFlight ? 250 : 0,
      "high"
    )
  );

  const due = candidate.observedDueDate;
  const overdue = due != null && due < input.context.businessDate;
  const dueToday = due === input.context.businessDate;
  factors.push(
    factor(
      "due_work",
      due,
      "weekly_growth_candidate.observedDueDate",
      overdue ? 200 : dueToday ? 150 : 0,
      due ? "high" : "unknown"
    )
  );

  const churnScore =
    candidate.sourceKind === "customer_recovery"
      ? signalNumber(candidate, "churn_score")
      : null;
  if (churnScore != null) {
    factors.push(
      factor(
        "customer_recovery_evidence",
        churnScore,
        "customer_churn_snapshot.score",
        Math.max(0, Math.min(100, Math.round(churnScore))),
        candidate.confidence === "low" ? "low" : "high"
      )
    );
  }

  const historyCount =
    candidate.sourceKind === "customer_recovery"
      ? signalNumber(candidate, "history_order_count")
      : null;
  if (historyCount != null) {
    factors.push(
      factor(
        "strong_customer_history",
        historyCount,
        "customer_churn_snapshot.historyOrderCount",
        historyCount >= 5 ? 40 : 0,
        candidate.confidence === "low" ? "low" : "high"
      )
    );
  }

  const aligned =
    input.context.macroGoal != null &&
    motionAlignsWithMacroGoal(
      input.context.macroGoal.metricKey,
      candidate.motion
    );
  factors.push(
    factor(
      "macro_goal_alignment",
      aligned,
      input.context.macroGoal
        ? "operator_macro_goals.metricKey + candidate.motion"
        : "no active macro goal",
      aligned ? 150 : 0,
      input.context.macroGoal ? "high" : "unknown"
    )
  );

  factors.push(
    factor(
      "prep_readiness",
      blockedReasons.includes("INSUFFICIENT_PREP") ||
        blockedReasons.includes("PREP_NOT_READY")
        ? false
        : true,
      campaign
        ? "candidate prep horizon + missionDirector prep receipt"
        : "candidate prep horizon",
      blockedReasons.includes("INSUFFICIENT_PREP") ||
        blockedReasons.includes("PREP_NOT_READY")
        ? 0
        : 20,
      "high"
    )
  );

  if (candidate.fit.minimumMinutes != null && candidate.fit.minimumMinutes > 0) {
    factors.push(
      factor(
        "pocket_fit",
        knownPocket?.usableMinutes ?? null,
        "missionDirector time pocket vs candidate minimumMinutes",
        knownPocket ? 40 : 0,
        knownPocket ? "high" : "low"
      )
    );
  }

  if (candidate.confidence === "low") {
    warnings.push("Candidate evidence confidence is low.");
  }
  if (candidate.assumptions.length > 0) {
    warnings.push("Candidate carries recorded assumptions; assumptions do not become facts.");
  }
  warnings.push("LLM output does not set Mission Director ranking.");

  const score = factors.reduce((sum, item) => sum + item.effect, 0);
  const confidence: "high" | "low" = factors.some(
    item => item.effect > 0 && item.confidence === "high"
  )
    ? "high"
    : "low";

  return {
    workId: candidate.id,
    title: candidate.title,
    objective: candidate.objective,
    completionCondition,
    sourceKind: candidate.sourceKind,
    sourceRefs: candidate.sourceRefs,
    score,
    confidence,
    executionType: execution.executionType,
    eligible: blockedReasons.length === 0,
    blockedReasons,
    factors,
    warnings,
  };
}

function selectionFrom(
  evidence: MissionWorkRankEvidence
): MissionWorkSelection | null {
  if (
    !evidence.eligible ||
    (evidence.executionType !== "mission" &&
      evidence.executionType !== "challenge")
  ) {
    return null;
  }
  return {
    workId: evidence.workId,
    title: evidence.title,
    objective: evidence.objective,
    completionCondition: evidence.completionCondition,
    sourceKind: evidence.sourceKind,
    sourceRefs: evidence.sourceRefs,
    executionType: evidence.executionType,
    rankEvidence: evidence,
  };
}

export function rankMissionDirectorWork(input: {
  candidates: readonly WeeklyGrowthCandidate[];
  campaigns: readonly GrowthCampaign[];
  campaignPrepReady: Readonly<Record<string, boolean>>;
  context: RankingContext;
  pockets: readonly TimePocket[];
  executionConstraint?: "mission" | "challenge" | null;
  protectDiscretionary?: boolean;
  protectedSourceIds?: readonly string[];
}): MissionAuthoritativeWorkPlan {
  const protectedSourceIds = new Set(input.protectedSourceIds ?? []);
  const ranking = input.candidates.map(candidate =>
    rankOne({
      candidate,
      campaigns: input.campaigns,
      campaignPrepReady: input.campaignPrepReady,
      context: input.context,
      pockets: input.pockets,
      executionConstraint: input.executionConstraint ?? null,
      protectDiscretionary: input.protectDiscretionary ?? false,
      protectedSourceIds,
    })
  );

  ranking.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.eligible && b.eligible && a.score !== b.score) return b.score - a.score;
    return a.workId.localeCompare(b.workId);
  });

  const primaryEvidence = ranking.find(item => item.eligible) ?? null;
  const primary = primaryEvidence ? selectionFrom(primaryEvidence) : null;
  if (primary) {
    return { status: "ranked", primary, ranking, reason: null };
  }
  return {
    status: "no_eligible_work",
    primary: null,
    ranking,
    reason: ranking.length ? "ALL_DISCOVERED_WORK_BLOCKED" : "NO_RANKABLE_WORK",
  };
}

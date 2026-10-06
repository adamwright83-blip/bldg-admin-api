import { describe, expect, it } from "vitest";
import type { WeeklyGrowthCandidate } from "../../shared/weeklyGrowthCandidates";
import type { PersistentObligation } from "./obligationStore";
import {
  inactiveGoalRunWaitReason,
  materializedExecutionType,
  selectDeterministicCycleChoice,
} from "./decisionEngine";

function candidate(
  id: string,
  overrides: Partial<WeeklyGrowthCandidate> = {}
): WeeklyGrowthCandidate {
  return {
    id,
    sourceKind: "campaign_library",
    motion: "account_acquisition",
    title: id,
    objective: `Visit ${id} in person`,
    alreadyInFlight: false,
    observedDueDate: null,
    sourceRefs: [
      {
        sourceKind: "campaign_library",
        sourceType: "campaign",
        sourceId: id,
      },
    ],
    provenance: {
      reader: "test",
      sourceType: "campaign",
      sourceIds: [id],
      observedAt: "2026-09-29T00:00:00.000Z",
    },
    prep: {
      leadDays: 0,
      condition: null,
      feasibleWithinHorizon: true,
    },
    fit: { pocketKind: null, minimumMinutes: null },
    observedSignals: [],
    assumptions: [],
    confidence: "high",
    rankReasons: ["CAMPAIGN_ENABLED"],
    ...overrides,
  };
}

function missionPlan(campaignId: string) {
  return {
    id: "plan-1",
    tenantId: "tenant-a",
    operatorId: "operator-a",
    businessDate: "2026-09-29",
    stableKey: "mission-director:tenant-a:operator-a:2026-09-29",
    revision: 1,
    inputFingerprint: "fp",
    outcome: {
      status: "planned",
      primary: { campaignId },
    },
    usageOutcome: null,
    createdAt: "2026-09-29T00:00:00.000Z",
  } as any;
}

function workPlan(workId: string, executionType: "mission" | "challenge" = "challenge") {
  const selected = candidate(workId);
  return {
    id: "plan-work",
    tenantId: "tenant-a",
    operatorId: "operator-a",
    businessDate: "2026-09-29",
    stableKey: "mission-director:tenant-a:operator-a:2026-09-29",
    revision: 2,
    inputFingerprint: "work-fp",
    outcome: {
      status: "no_plan",
      reason: "NO_PREPARED_FALLBACK",
      remedy: "Legacy campaign projection only.",
      workPlan: {
        status: "ranked",
        primary: {
          workId,
          title: selected.title,
          objective: selected.objective,
          completionCondition: null,
          sourceKind: selected.sourceKind,
          sourceRefs: selected.sourceRefs,
          executionType,
          rankEvidence: {
            workId,
            title: selected.title,
            objective: selected.objective,
            completionCondition: null,
            sourceKind: selected.sourceKind,
            sourceRefs: selected.sourceRefs,
            score: 100,
            confidence: "high",
            executionType,
            eligible: true,
            blockedReasons: [],
            factors: [],
            warnings: [],
          },
        },
        ranking: [
          {
            workId,
            title: selected.title,
            objective: selected.objective,
            completionCondition: null,
            sourceKind: selected.sourceKind,
            sourceRefs: selected.sourceRefs,
            score: 100,
            confidence: "high",
            executionType,
            eligible: true,
            blockedReasons: [],
            factors: [],
            warnings: [],
          },
        ],
        reason: null,
      },
    },
    usageOutcome: null,
    createdAt: "2026-09-29T00:00:00.000Z",
  } as any;
}

function obligation(id: string): PersistentObligation {
  return {
    id,
    tenantId: "tenant-a",
    operatorUserId: "operator-a",
    canonicalOperatorId: "tenant:tenant-a:operator:operator-a",
    kind: "sales_follow_up",
    subjectKey: id,
    status: "scheduled",
    dueDate: "2026-09-29",
    payload: {
      id,
      kind: "sales_follow_up",
      subjectKey: id,
      subjectName: "Account",
      status: "scheduled",
      dueDate: "2026-09-29",
      title: "Follow up",
      why: "Due",
      draft: null,
      historyIntact: true,
      moveCount: 0,
    },
    goalRunId: null,
    cycleId: null,
    decisionId: null,
    executionType: null,
    commercialFollowUpRef: null,
    objectiveRef: null,
    agentEventId: null,
  };
}

describe("PR4 inactive goal-run gating", () => {
  it("withholds actionable selection for every non-active run", () => {
    expect(inactiveGoalRunWaitReason("active")).toBeNull();
    expect(inactiveGoalRunWaitReason("completed")).toBe("GOAL_RUN_COMPLETED");
    expect(inactiveGoalRunWaitReason("paused")).toBe("GOAL_RUN_INACTIVE");
    expect(inactiveGoalRunWaitReason("superseded")).toBe("GOAL_RUN_INACTIVE");
    expect(inactiveGoalRunWaitReason("cancelled")).toBe("GOAL_RUN_INACTIVE");
  });
});

describe("PR4 execution materialization", () => {
  it("does not let an obligation reclassify Mission Director-selected work", () => {
    expect(
      materializedExecutionType({
        authoritative: "challenge",
        obligation: "mission",
        derived: "mission",
      })
    ).toBe("challenge");
  });

  it("keeps compatibility fallbacks when no authoritative workPlan type exists", () => {
    expect(
      materializedExecutionType({
        authoritative: null,
        obligation: "mission",
        derived: "challenge",
      })
    ).toBe("mission");
  });
});

describe("PR4 deterministic goal-cycle selection", () => {
  it("materializes Mission Director work even when WeeklyIntent is not the ranker", () => {
    const chosen = candidate("director-work");
    const result = selectDeterministicCycleChoice({
      weeklyIntentLocked: false,
      candidates: [candidate("feed-first"), chosen],
      obligations: [],
      missionDirectorPlan: workPlan("director-work", "challenge"),
    });
    expect(result).toMatchObject({
      selectionKind: "candidate",
      selectedRef: "director-work",
      selectedReasonCode: "MISSION_DIRECTOR_PRIMARY",
    });
  });


  it("does not manufacture a new candidate objective when the week is unplanned", () => {
    const result = selectDeterministicCycleChoice({
      weeklyIntentLocked: false,
      candidates: [candidate("campaign-a")],
      obligations: [],
      missionDirectorPlan: null,
    });
    expect(result).toMatchObject({
      selectionKind: "wait",
      selectedRef: null,
      selectedReasonCode: "WEEKLY_INTENT_UNPLANNED",
    });
    expect(result.blockedCandidates).toEqual([
      {
        id: "campaign-a",
        reasons: ["WEEK_UNPLANNED_NEW_OBJECTIVE_WITHHELD"],
      },
    ]);
  });

  it("does not let a due obligation self-promote during an unplanned week", () => {
    const due = obligation("obligation-a");
    const result = selectDeterministicCycleChoice({
      weeklyIntentLocked: false,
      candidates: [candidate("campaign-a")],
      obligations: [due],
      missionDirectorPlan: null,
    });
    expect(result).toMatchObject({
      selectionKind: "wait",
      selectedRef: null,
      selectedReasonCode: "WEEKLY_INTENT_UNPLANNED",
    });
  });

  it("does not rank competing obligations outside Mission Director", () => {
    const claimed = obligation("obligation-claimed");
    claimed.decisionId = "decision-prior";
    claimed.objectiveRef = "objective-prior";
    const unclaimed = obligation("obligation-unclaimed");
    const result = selectDeterministicCycleChoice({
      weeklyIntentLocked: false,
      candidates: [candidate("campaign-a")],
      obligations: [claimed, unclaimed],
      missionDirectorPlan: null,
    });
    expect(result).toMatchObject({
      selectionKind: "wait",
      selectedRef: null,
      selectedReasonCode: "WEEKLY_INTENT_UNPLANNED",
    });
  });

  it("does not turn candidate-feed order into business priority", () => {
    const first = candidate("not-ready", {
      prep: {
        leadDays: 2,
        condition: "print",
        feasibleWithinHorizon: false,
      },
    });
    const second = candidate("ready");
    const result = selectDeterministicCycleChoice({
      weeklyIntentLocked: true,
      candidates: [first, second],
      obligations: [],
      missionDirectorPlan: null,
    });
    expect(result).toMatchObject({
      selectionKind: "wait",
      selectedRef: null,
      selectedReasonCode: "NO_AUTHORITATIVE_PLAN",
    });
    expect(result.blockedCandidates).toEqual([
      { id: "not-ready", reasons: ["INSUFFICIENT_PREP"] },
    ]);
  });

  it("selects an eligible candidate only when Mission Director chose it", () => {
    const first = candidate("feed-first");
    const selected = candidate("director-selected");
    const result = selectDeterministicCycleChoice({
      weeklyIntentLocked: true,
      candidates: [first, selected],
      obligations: [],
      missionDirectorPlan: missionPlan("director-selected"),
    });
    expect(result).toMatchObject({
      selectionKind: "candidate",
      selectedRef: "director-selected",
      selectedReasonCode: "MISSION_DIRECTOR_PRIMARY",
    });
  });

  it("does not elevate a future obligation-only candidate from feed order", () => {
    const future = obligation("obligation-future");
    future.dueDate = "2026-10-02";
    const candidateMatchingFuture = candidate("candidate-future", {
      sourceRefs: [
        {
          sourceKind: "proactive_obligation",
          sourceType: "sales_follow_up",
          sourceId: "obligation-future",
        },
      ],
    });
    const result = selectDeterministicCycleChoice({
      weeklyIntentLocked: true,
      candidates: [candidateMatchingFuture],
      obligations: [future],
      dueObligations: [],
      missionDirectorPlan: null,
    });
    expect(result).toMatchObject({
      selectionKind: "wait",
      selectedRef: null,
      selectedObligation: null,
      selectedReasonCode: "NO_AUTHORITATIVE_PLAN",
    });
  });

  it("restricts unplanned week selection exclusively to due obligations", () => {
    const future = obligation("obligation-future");
    future.dueDate = "2026-10-02";
    const result = selectDeterministicCycleChoice({
      weeklyIntentLocked: false,
      candidates: [candidate("campaign-a")],
      obligations: [future],
      dueObligations: [],
      missionDirectorPlan: null,
    });
    expect(result).toMatchObject({
      selectionKind: "wait",
      selectedRef: null,
      selectedReasonCode: "WEEKLY_INTENT_UNPLANNED",
    });
  });

  it("restricts fallback selection when candidates are empty to due obligations", () => {
    const future = obligation("obligation-future");
    future.dueDate = "2026-10-02";
    const result = selectDeterministicCycleChoice({
      weeklyIntentLocked: true,
      candidates: [],
      obligations: [future],
      dueObligations: [],
      missionDirectorPlan: null,
    });
    expect(result).toMatchObject({
      selectionKind: "wait",
      selectedRef: null,
      selectedReasonCode: "NO_AUTHORITATIVE_PLAN",
    });
  });

  it("determines inactive goal run wait reasons accurately", () => {
    expect(inactiveGoalRunWaitReason("active")).toBeNull();
    expect(inactiveGoalRunWaitReason("completed")).toBe("GOAL_RUN_COMPLETED");
    expect(inactiveGoalRunWaitReason("paused")).toBe("GOAL_RUN_INACTIVE");
    expect(inactiveGoalRunWaitReason("cancelled")).toBe("GOAL_RUN_INACTIVE");
  });
});


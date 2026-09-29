import { describe, expect, it } from "vitest";
import type { WeeklyGrowthCandidate } from "../../shared/weeklyGrowthCandidates";
import type { PersistentObligation } from "./obligationStore";
import { selectDeterministicCycleChoice } from "./decisionEngine";

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

describe("PR4 deterministic goal-cycle selection", () => {
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

  it("lets an existing due obligation continue during an unplanned week", () => {
    const due = obligation("obligation-a");
    const result = selectDeterministicCycleChoice({
      weeklyIntentLocked: false,
      candidates: [candidate("campaign-a")],
      obligations: [due],
      missionDirectorPlan: null,
    });
    expect(result).toMatchObject({
      selectionKind: "obligation",
      selectedRef: "obligation-a",
      selectedReasonCode: "EXISTING_DUE_OBLIGATION_UNPLANNED_WEEK",
    });
  });

  it("uses canonical feed order and blocks prep-infeasible candidates", () => {
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
      selectionKind: "candidate",
      selectedRef: "ready",
      selectedReasonCode: "CANONICAL_FEED_FIRST_ELIGIBLE",
    });
    expect(result.blockedCandidates).toEqual([
      { id: "not-ready", reasons: ["INSUFFICIENT_PREP"] },
    ]);
  });
});

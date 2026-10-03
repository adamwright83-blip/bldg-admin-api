import { describe, expect, it } from "vitest";
import { goalCycleDecisionFingerprint, type GoalCycleDecisionDraft } from "./decisionStore";

function draft(): GoalCycleDecisionDraft {
  return {
    tenantId: "tenant-a",
    goalRunId: "run-a",
    cycleId: "cycle-a",
    canonicalOperatorId: "tenant:tenant-a:operator:operator-a",
    operatorUserId: "operator-a",
    policyVersion: "persistent-growth-phase0-v1",
    weeklyIntentId: "intent-a",
    weeklyIntentRevision: 2,
    weekStart: "2026-09-28",
    candidateFingerprint: "feed-a",
    candidateIds: ["b", "a"],
    candidateReasonCodes: { b: ["FOLLOW_UP_DUE"], a: ["CAMPAIGN_ENABLED"] },
    missionDirectorPlanId: "plan-a",
    missionDirectorRevision: 3,
    selectionKind: "candidate",
    selectedRef: "b",
    selectedExecutionType: "challenge",
    selectedReasonCode: "CANONICAL_FEED_FIRST_ELIGIBLE",
    evidenceRefs: ["source:b"],
    blockedCandidates: [],
    priorComparableDecisionId: null,
    sourceCoverage: { campaign_library: { status: "available" } },
    loadout: [],
    experiment: null,
  };
}

describe("goal cycle decision fingerprint", () => {
  it("is deterministic for the same historical decision payload", () => {
    expect(goalCycleDecisionFingerprint(draft())).toBe(
      goalCycleDecisionFingerprint(draft())
    );
  });

  it("changes when the selected work changes", () => {
    const left = draft();
    const right = { ...draft(), selectedRef: "a" };
    expect(goalCycleDecisionFingerprint(left)).not.toBe(
      goalCycleDecisionFingerprint(right)
    );
  });
});

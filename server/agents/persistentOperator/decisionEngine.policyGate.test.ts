import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyDayforgeSaasTenants, macroGoalRuns } from "../../../drizzle/schema";

// Stage 1 1C-ii: a goal-cycle decision records the action policy's answer, and
// anything but "allowed" is a wait that reads, ranks and materializes nothing.

const run = {
  id: "run-1",
  tenantId: "t1",
  canonicalOperatorId: "tenant:t1:operator:adam",
  operatorUserId: "adam",
  status: "active",
  policyVersion: "v1",
  verticalKey: "laundry_fluff_fold",
  completionEvidenceRef: null,
};

const mocks = vi.hoisted(() => ({
  run: { current: null as Record<string, unknown> | null },
  appendGoalCycleDecision: vi.fn(),
  loadWeeklyGrowthCandidates: vi.fn(),
  planForDate: vi.fn(),
  listOpenPersistentObligations: vi.fn(),
  materializeGoalCycleObjective: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: (table: unknown) => {
        const rows =
          table === macroGoalRuns
            ? [mocks.run.current]
            : table === legacyDayforgeSaasTenants
              ? [{ timeZone: "America/Los_Angeles" }]
              : [];
        const chain = {
          where: () => chain,
          orderBy: () => chain,
          limit: async () => rows,
        };
        return chain;
      },
    }),
  }),
}));
vi.mock("./identity", () => ({
  resolveCanonicalOperatorIdentity: vi.fn(async () => ({
    ok: true,
    identity: {
      canonicalOperatorId: "tenant:t1:operator:adam",
      canonicalOpenId: "adam",
      dayDirectorActorId: "42",
      dayDirectorActorIds: ["42"],
      aliases: [],
    },
  })),
}));
vi.mock("./decisionStore", () => ({
  findDecisionForCycle: vi.fn(async () => null),
  findPriorComparableDecision: vi.fn(async () => null),
  appendGoalCycleDecision: mocks.appendGoalCycleDecision,
}));
vi.mock("../../weeklyGrowthCandidates/loadWeeklyGrowthCandidates", () => ({
  loadWeeklyGrowthCandidates: mocks.loadWeeklyGrowthCandidates,
}));
vi.mock("../../planning/missionDirector/missionDirectorService", () => ({ planForDate: mocks.planForDate }));
vi.mock("./obligationStore", () => ({
  listOpenPersistentObligations: mocks.listOpenPersistentObligations,
  attachObligationDecisionLineage: vi.fn(),
}));
vi.mock("./objectiveStore", () => ({
  materializeGoalCycleObjective: mocks.materializeGoalCycleObjective,
  getGoalCycleObjectiveByDecision: vi.fn(async () => null),
}));
vi.mock("../../executionIntelligence/selectExecutionIntelligence", () => ({
  selectExecutionIntelligence: vi.fn(async () => []),
}));

import { decideGoalCycle } from "./decisionEngine";
import type { GoalCycleActionPolicy } from "./goalCyclePolicy";

const base = { exactAction: "persistent_operator.goal_cycle.prepare", riskClass: "INTERNAL_REVERSIBLE" } as const;
const allowed: GoalCycleActionPolicy = { ...base, status: "allowed", authority: "automatic" };

function decide(actionPolicy: GoalCycleActionPolicy | undefined) {
  return decideGoalCycle({
    tenantId: "t1",
    runId: "run-1",
    cycleId: "cycle-1",
    registry: {} as never,
    actionPolicy: actionPolicy as GoalCycleActionPolicy,
    now: new Date("2026-10-19T17:00:00.000Z"),
  });
}

function appendedDraft() {
  expect(mocks.appendGoalCycleDecision).toHaveBeenCalledTimes(1);
  return mocks.appendGoalCycleDecision.mock.calls[0]![0] as {
    selectionKind: string;
    selectedReasonCode: string;
    sourceCoverage: { actionPolicy?: unknown; goalRun?: string };
  };
}

function expectNothingRead() {
  expect(mocks.loadWeeklyGrowthCandidates).not.toHaveBeenCalled();
  expect(mocks.planForDate).not.toHaveBeenCalled();
  expect(mocks.listOpenPersistentObligations).not.toHaveBeenCalled();
  expect(mocks.materializeGoalCycleObjective).not.toHaveBeenCalled();
}

describe("goal-cycle decision policy gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.current = { ...run };
    mocks.appendGoalCycleDecision.mockImplementation(async draft => ({
      decision: { ...draft, id: "decision-1" },
      created: true,
    }));
    mocks.loadWeeklyGrowthCandidates.mockResolvedValue({ candidates: [], fingerprint: "fp", sources: [] });
    mocks.listOpenPersistentObligations.mockResolvedValue([]);
    mocks.planForDate.mockResolvedValue(null);
  });

  it("a denied policy records a wait with the reason and reads nothing", async () => {
    const denied: GoalCycleActionPolicy = { ...base, status: "denied", reason: "entitlement_required" };
    const result = await decide(denied);
    const draft = appendedDraft();
    expect(draft).toMatchObject({ selectionKind: "wait", selectedReasonCode: "ACTION_POLICY_DENIED" });
    expect(draft.sourceCoverage.actionPolicy).toEqual(denied);
    expect(result.objective).toBeNull();
    expectNothingRead();
  });

  it("a missing policy fails closed as a wait", async () => {
    await decide(undefined);
    expect(appendedDraft()).toMatchObject({ selectionKind: "wait", selectedReasonCode: "ACTION_POLICY_NOT_EVALUATED" });
    expectNothingRead();
  });

  it("a paused run waits and records that the policy was not asked", async () => {
    mocks.run.current = { ...run, status: "paused" };
    const notEvaluated: GoalCycleActionPolicy = { ...base, status: "not_evaluated", reason: "goal_run_inactive" };
    await decide(notEvaluated);
    const draft = appendedDraft();
    expect(draft).toMatchObject({ selectionKind: "wait", selectedReasonCode: "GOAL_RUN_INACTIVE" });
    expect(draft.sourceCoverage).toMatchObject({ goalRun: "paused", actionPolicy: notEvaluated });
    expectNothingRead();
  });

  it("an allowed policy proceeds to selection and is recorded on the decision", async () => {
    await decide(allowed);
    const draft = appendedDraft();
    expect(draft.sourceCoverage.actionPolicy).toEqual(allowed);
    expect(draft.sourceCoverage.actionPolicy).not.toMatchObject({ status: "not_applicable" });
    expect(mocks.loadWeeklyGrowthCandidates).toHaveBeenCalledTimes(1);
    expect(mocks.planForDate).toHaveBeenCalledTimes(1);
  });
});

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistentActionPolicyDecision } from "./actionPolicy";
import { evaluateGoalCyclePreparePolicy, type GoalCycleActionPolicy } from "./goalCyclePolicy";
import { runGoalCycleStep, type GoalCycleStepDeps } from "./goalCycleStep";

// Stage 1 1C-ii: preparation happens only when the persistent action policy
// allows it, and the decision records the policy's answer either way.

const run = {
  id: "run-1",
  tenantId: "t1",
  canonicalOperatorId: "tenant:t1:operator:adam",
  operatorUserId: "adam",
  status: "active",
  nextEvaluationAt: new Date("2026-10-19T18:00:00.000Z"),
};

function harness(input: {
  runStatus?: string;
  policy: PersistentActionPolicyDecision;
}) {
  const policyCalls: unknown[] = [];
  const deps = {
    registry: {} as never,
    appointmentStore: {} as never,
    evaluateRun: vi.fn(async () => ({
      run: { ...run, status: input.runStatus ?? "active" },
      completed: false,
      observation: null,
    })),
    // The real policy wrapper, over a stubbed persistent action policy.
    evaluatePolicy: ((args: Parameters<typeof evaluateGoalCyclePreparePolicy>[0]) =>
      evaluateGoalCyclePreparePolicy(args, async request => {
        policyCalls.push(request);
        return input.policy;
      })) as never,
    resolveIdentity: vi.fn(async () => ({ ok: true, identity: { canonicalOperatorId: run.canonicalOperatorId } })),
    resolveTimeZone: vi.fn(async () => "America/Los_Angeles"),
    prepare: vi.fn(async () => ({ id: "proposal-1" })),
    scheduleCall: vi.fn(async () => ({ scheduled: false, reason: "no_authorized_channel" })),
    decide: vi.fn(async (args: { actionPolicy: GoalCycleActionPolicy }) => ({
      decision: {
        id: "decision-1",
        selectionKind: "wait",
        selectedRef: null,
        selectedReasonCode: args.actionPolicy.status === "allowed" ? "NO_ELIGIBLE_WORK" : "ACTION_POLICY_DENIED",
      },
      created: true,
      objective: null,
    })),
  } satisfies Partial<Record<keyof GoalCycleStepDeps, unknown>>;
  return {
    deps,
    policyCalls,
    run: () => runGoalCycleStep({ tenantId: "t1", runId: "run-1", cycleId: "cycle-1" }, deps as unknown as GoalCycleStepDeps),
  };
}

const allowed: PersistentActionPolicyDecision = {
  allowed: true,
  authority: "automatic",
  standingAuthorizationId: null,
  standingAuthorizationVersion: null,
};

describe("goal-cycle step policy gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks the policy for the exact prepare action at INTERNAL_REVERSIBLE", async () => {
    const box = harness({ policy: allowed });
    await box.run();
    expect(box.policyCalls).toEqual([
      expect.objectContaining({
        tenantId: "t1",
        canonicalOperatorId: run.canonicalOperatorId,
        operatorUserId: "adam",
        exactAction: "persistent_operator.goal_cycle.prepare",
        riskClass: "INTERNAL_REVERSIBLE",
      }),
    ]);
  });

  it("allowed: prepares once and records the allowed policy on the decision", async () => {
    const box = harness({ policy: allowed });
    const result = await box.run();
    expect(box.deps.prepare).toHaveBeenCalledTimes(1);
    expect(box.deps.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        cycleId: "cycle-1",
        actionPolicy: {
          status: "allowed",
          authority: "automatic",
          exactAction: "persistent_operator.goal_cycle.prepare",
          riskClass: "INTERNAL_REVERSIBLE",
        },
      })
    );
    expect(result).toMatchObject({ actionPolicy: "allowed", nextEvaluationAt: "2026-10-19T18:00:00.000Z" });
  });

  it.each([["entitlement_required"], ["role_not_allowed"], ["identity_unresolved"]] as const)(
    "denied (%s): prepares nothing, schedules no call, and records the reason",
    async reason => {
      const box = harness({ policy: { allowed: false, reason } });
      const result = await box.run();
      expect(box.deps.prepare).not.toHaveBeenCalled();
      expect(box.deps.scheduleCall).not.toHaveBeenCalled();
      expect(box.deps.decide).toHaveBeenCalledWith(
        expect.objectContaining({ actionPolicy: expect.objectContaining({ status: "denied", reason }) })
      );
      expect(result.actionPolicy).toBe("denied");
      // The next occurrence is still scheduled; a denial is a wait, not a dead letter.
      expect(result.nextEvaluationAt).toBe("2026-10-19T18:00:00.000Z");
    }
  );

  it("paused run: the policy is not asked and nothing is prepared", async () => {
    const box = harness({ runStatus: "paused", policy: allowed });
    await box.run();
    expect(box.policyCalls).toEqual([]);
    expect(box.deps.prepare).not.toHaveBeenCalled();
    expect(box.deps.decide).toHaveBeenCalledWith(
      expect.objectContaining({ actionPolicy: expect.objectContaining({ status: "not_evaluated", reason: "goal_run_inactive" }) })
    );
  });

  it("both goal-cycle workers run this one gated step", () => {
    for (const path of ["server/agents/persistentOperator/autonomousWorkerService.ts", "server/procurement/workerMain.ts"]) {
      const source = readFileSync(path, "utf8");
      expect(source).toMatch(/runGoalCycleStep\(/);
      expect(source).not.toMatch(/decideGoalCycle\(/);
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import type { PersistentActionPolicyDecision } from "./actionPolicy";
import { runGoalCycleOccurrence, type GoalCycleOccurrenceDeps } from "./goalCycleOccurrence";
import { GOAL_CYCLE_PREPARE_ACTION, goalCyclePolicyReceipt } from "./goalCyclePolicy";

/**
 * Stage 1 · 1C-ii: the goal-cycle occurrence asks evaluatePersistentActionPolicy
 * first. Allowed → evaluate, prepare, decide, with the receipt recorded.
 * Denied → a wait decision with the reason, and no preparation.
 */
const NOW = new Date("2026-10-19T17:00:00.000Z");
const input = { tenantId: "tenant-1c", runId: "run-1", cycleId: "cycle-1" };

function harness(options: {
  policy: PersistentActionPolicyDecision;
  runStatus?: string;
  prepareFails?: boolean;
}) {
  const calls: string[] = [];
  const run = {
    id: "run-1",
    status: options.runStatus ?? "active",
    canonicalOperatorId: "tenant:tenant-1c:operator:adam",
    operatorUserId: "adam",
  };
  const deps: GoalCycleOccurrenceDeps = {
    now: () => NOW,
    loadRun: vi.fn(async () => {
      calls.push("loadRun");
      return run;
    }),
    evaluatePolicy: vi.fn(async () => {
      calls.push("evaluatePolicy");
      return options.policy;
    }),
    evaluateRun: vi.fn(async () => {
      calls.push("evaluateRun");
      return {
        run: { ...run, nextEvaluationAt: new Date(NOW.getTime() + 3_600_000) },
        completed: false,
        observation: { value: 3 },
      };
    }),
    prepare: vi.fn(async () => {
      calls.push("prepare");
      if (options.prepareFails) throw new Error("diagnosis reader unavailable");
    }),
    decide: vi.fn(async ({ actionPolicy }) => {
      calls.push("decide");
      const allowed = actionPolicy.status === "allowed";
      return {
        decision: {
          id: "decision-1",
          selectionKind: allowed ? "candidate" : "wait",
          selectedRef: allowed ? "cand-1" : null,
          selectedReasonCode: allowed ? "MISSION_DIRECTOR_PRIMARY" : "ACTION_POLICY_DENIED",
        },
        created: true,
        objective: allowed ? { id: "objective-1" } : null,
      } as never;
    }),
  };
  return { calls, deps };
}

const allowed: PersistentActionPolicyDecision = {
  allowed: true,
  authority: "automatic",
  standingAuthorizationId: null,
  standingAuthorizationVersion: null,
};

describe("goal-cycle occurrence: policy gate before preparation", () => {
  it("allowed: asks for the exact INTERNAL_REVERSIBLE prepare action, then evaluates, prepares and decides with the receipt", async () => {
    const h = harness({ policy: allowed });
    const result = await runGoalCycleOccurrence(input, h.deps);
    expect(h.calls).toEqual(["loadRun", "evaluatePolicy", "evaluateRun", "prepare", "decide"]);
    expect(h.deps.evaluatePolicy).toHaveBeenCalledWith({
      tenantId: "tenant-1c",
      canonicalOperatorId: "tenant:tenant-1c:operator:adam",
      operatorUserId: "adam",
      exactAction: "persistent_operator.goal_cycle.prepare",
      riskClass: "INTERNAL_REVERSIBLE",
      now: NOW,
    });
    const receipt = {
      policy: "evaluatePersistentActionPolicy",
      exactAction: GOAL_CYCLE_PREPARE_ACTION,
      riskClass: "INTERNAL_REVERSIBLE",
      status: "allowed",
      authority: "automatic",
      standingAuthorizationId: null,
      standingAuthorizationVersion: null,
    };
    expect(h.deps.decide).toHaveBeenCalledWith({ ...input, actionPolicy: receipt });
    expect(result).toMatchObject({ prepared: true, actionPolicy: receipt, decisionId: "decision-1", objectiveId: "objective-1" });
  });

  for (const reason of ["entitlement_required", "role_not_allowed", "identity_unresolved", "missing_identity"] as const) {
    it(`denied (${reason}): records a wait with the reason and prepares nothing`, async () => {
      const h = harness({ policy: { allowed: false, reason } });
      const result = await runGoalCycleOccurrence(input, h.deps);
      expect(h.calls).toEqual(["loadRun", "evaluatePolicy", "decide"]);
      expect(h.deps.evaluateRun).not.toHaveBeenCalled();
      expect(h.deps.prepare).not.toHaveBeenCalled();
      expect(h.deps.decide).toHaveBeenCalledWith({
        ...input,
        actionPolicy: expect.objectContaining({ status: "denied", reason }),
      });
      expect(result).toMatchObject({ prepared: false, selectionKind: "wait", selectedReasonCode: "ACTION_POLICY_DENIED" });
      // The run's hourly heartbeat continues so a restored grant is picked up.
      expect(result.nextEvaluationAt).toBe("2026-10-19T18:00:00.000Z");
    });
  }

  it("paused run: decides to wait and prepares nothing", async () => {
    const h = harness({ policy: allowed, runStatus: "paused" });
    const result = await runGoalCycleOccurrence(input, h.deps);
    expect(h.deps.prepare).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["loadRun", "evaluatePolicy", "evaluateRun", "decide"]);
    expect(result.prepared).toBe(false);
  });

  it("paused run with a denied policy schedules no recheck", async () => {
    const h = harness({ policy: { allowed: false, reason: "role_not_allowed" }, runStatus: "paused" });
    const result = await runGoalCycleOccurrence(input, h.deps);
    expect(result.nextEvaluationAt).toBeNull();
  });

  it("a preparation failure propagates so the leased step retries", async () => {
    const h = harness({ policy: allowed, prepareFails: true });
    await expect(runGoalCycleOccurrence(input, h.deps)).rejects.toThrow("diagnosis reader unavailable");
    expect(h.deps.decide).not.toHaveBeenCalled();
  });

  it("a missing run fails the step instead of deciding", async () => {
    const h = harness({ policy: allowed });
    h.deps.loadRun = vi.fn(async () => null);
    await expect(runGoalCycleOccurrence(input, h.deps)).rejects.toThrow("Macro goal run not found");
    expect(h.deps.evaluatePolicy).not.toHaveBeenCalled();
  });
});

describe("goal-cycle policy receipt never admits Day Line work", () => {
  it("the Day Line write boundary refuses an allowed INTERNAL_REVERSIBLE receipt", async () => {
    const { assertDayLineAdmission } = await import("../../planning/dayDirector/dayLineAdmission");
    await expect(
      assertDayLineAdmission({
        tenantId: "tenant-1c",
        actorIds: ["1"],
        businessDate: "2026-10-19",
        proposal: { promptKey: "strategy:x" },
        admission: goalCyclePolicyReceipt(allowed),
      })
    ).rejects.toThrow(/Day Line write refused/);
  });
});

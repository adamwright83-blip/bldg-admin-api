import { describe, expect, it } from "vitest";
import {
  projectToGoldlineObjective,
  projectToRankedDayWork,
  type PersistentGrowthObjective,
} from "./objectiveStore";

function sampleObjective(
  overrides: Partial<PersistentGrowthObjective> = {}
): PersistentGrowthObjective {
  return {
    id: "obj-123",
    tenantId: "tenant-a",
    goalRunId: "run-456",
    cycleId: "cycle-789",
    decisionId: "dec-abc",
    canonicalOperatorId: "tenant:tenant-a:operator:operator-a",
    operatorUserId: "operator-a",
    selectionKind: "candidate",
    selectedRef: "candidate-1",
    title: "Visit Account In Person",
    description: "Conduct in-person field check-in",
    executionType: "mission",
    authority: "HUMAN_EXECUTION",
    status: "presented",
    statusReason: null,
    actionTargetType: "campaign",
    actionTargetId: "campaign-1",
    actionTargetDisplayName: "Campaign 1",
    businessDate: "2026-09-29",
    windowStart: null,
    windowEnd: null,
    loadout: [
      {
        id: "intel-1",
        label: "Check historical volume",
        kind: "context",
        detail: "Account ordered 2 weeks ago",
        sourceRef: "order:123",
      },
    ],
    evidenceRefs: ["evidence:1"],
    completedAt: null,
    createdAt: "2026-09-29T10:00:00.000Z",
    updatedAt: "2026-09-29T10:00:00.000Z",
    ...overrides,
  };
}

describe("Persistent Growth Objective Store (Slice H)", () => {
  describe("projectToGoldlineObjective", () => {
    it("projects a field mission objective into a Goldline adventure commercial_visit", () => {
      const obj = sampleObjective({ executionType: "mission" });
      const projected = projectToGoldlineObjective(obj);

      expect(projected.id).toBe(obj.id);
      expect(projected.physicalEntityId).toBe(obj.actionTargetId);
      expect(projected.kind).toBe("commercial_visit");
      expect(projected.authority).toBe("persisted_task");
      expect(projected.status).toBe("ready");
      expect(projected.priority).toBe(10);
      expect(projected.sourceEvidenceReference).toBe("goal_cycle_decisions:dec-abc");
    });

    it("projects a customer-oriented objective into a recovery objective", () => {
      const obj = sampleObjective({
        actionTargetType: "customer",
        actionTargetId: "cust-99",
        executionType: "challenge",
      });
      const projected = projectToGoldlineObjective(obj);

      expect(projected.kind).toBe("recovery");
      expect(projected.priority).toBe(8);
      expect(projected.physicalEntityId).toBe("cust-99");
    });

    it("maps terminal and blocked statuses accurately without manufacturing truth", () => {
      const completed = sampleObjective({ status: "completed" });
      expect(projectToGoldlineObjective(completed).status).toBe("completed");

      const blocked = sampleObjective({ status: "blocked" });
      expect(projectToGoldlineObjective(blocked).status).toBe("blocked");

      const inProgress = sampleObjective({ status: "in_progress" });
      expect(projectToGoldlineObjective(inProgress).status).toBe("ready");
    });
  });

  describe("projectToRankedDayWork", () => {
    it("projects a persistent growth objective into Day Line ranked work without duplicating entities", () => {
      const obj = sampleObjective({
        executionType: "hybrid_objective",
      });
      const ranked = projectToRankedDayWork(obj);

      expect(ranked.id).toBe("obj-123");
      expect(ranked.title).toBe("Visit Account In Person");
      expect(ranked.objective).toBe("Conduct in-person field check-in");
      expect(ranked.completionCondition).toBe("Conduct in-person field check-in");
      expect(ranked.executionType).toBe("hybrid_objective");
    });
  });

  describe("lineage preservation", () => {
    it("retains all durable decision lineage keys on the objective record", () => {
      const obj = sampleObjective();
      expect(obj.tenantId).toBe("tenant-a");
      expect(obj.goalRunId).toBe("run-456");
      expect(obj.cycleId).toBe("cycle-789");
      expect(obj.decisionId).toBe("dec-abc");
      expect(obj.canonicalOperatorId).toBe("tenant:tenant-a:operator:operator-a");
      expect(obj.operatorUserId).toBe("operator-a");
      expect(obj.selectionKind).toBe("candidate");
      expect(obj.selectedRef).toBe("candidate-1");
      expect(obj.loadout).toHaveLength(1);
      expect(obj.loadout[0].id).toBe("intel-1");
      expect(obj.authority).toBe("HUMAN_EXECUTION");
    });
  });
});

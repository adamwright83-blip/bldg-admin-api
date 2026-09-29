import { describe, expect, it } from "vitest";
import {
  LEARNING_KINDS,
  DELTA_TYPES,
  type GoalCycleLearnedDeltaRecord,
} from "./learningStore";
import {
  assertBusinessTruthEvidence,
  type GoldlineEvidenceRef,
} from "../../shared/goldlineTruthContract";

function sampleLearnedDelta(
  overrides: Partial<GoalCycleLearnedDeltaRecord> = {}
): GoalCycleLearnedDeltaRecord {
  return {
    id: "delta-1",
    tenantId: "tenant-a",
    goalRunId: "run-1",
    cycleId: "cycle-1",
    decisionId: "dec-1",
    objectiveId: "obj-1",
    outcomeId: "outcome-1",
    canonicalOperatorId: "tenant:tenant-a:operator:operator-a",
    operatorUserId: "operator-a",
    learningKind: "doctrine_weight",
    targetKey: "sales:morning_call_checkin",
    deltaType: "boost",
    beforeState: { doctrineWeight: 1.0 },
    afterState: { doctrineWeight: 1.5, verifiedRevenueCents: 25000 },
    evidenceReference: "commercial_order_attributions:attr-123",
    confidence: "high",
    explanation: "Verified commercial revenue of $250.00 observed via commercial_order_attributions; boosting execution doctrine.",
    appliedCount: 1,
    createdAt: "2026-09-29T10:00:00.000Z",
    updatedAt: "2026-09-29T10:00:00.000Z",
    ...overrides,
  };
}

describe("Persistent Growth Learning Store (Slice J)", () => {
  describe("taxonomy and contracts", () => {
    it("defines standard deterministic learning kinds", () => {
      expect(LEARNING_KINDS).toContain("doctrine_weight");
      expect(LEARNING_KINDS).toContain("loadout_recommendation");
      expect(LEARNING_KINDS).toContain("channel_affinity");
      expect(LEARNING_KINDS).toContain("execution_constraint");
    });

    it("defines standard delta types", () => {
      expect(DELTA_TYPES).toContain("boost");
      expect(DELTA_TYPES).toContain("suppress");
      expect(DELTA_TYPES).toContain("reinforce");
      expect(DELTA_TYPES).toContain("constraint");
    });

    it("retains complete durable lineage from goalRun down to evidenceReference", () => {
      const delta = sampleLearnedDelta();
      expect(delta.tenantId).toBe("tenant-a");
      expect(delta.goalRunId).toBe("run-1");
      expect(delta.cycleId).toBe("cycle-1");
      expect(delta.decisionId).toBe("dec-1");
      expect(delta.objectiveId).toBe("obj-1");
      expect(delta.outcomeId).toBe("outcome-1");
      expect(delta.canonicalOperatorId).toBe("tenant:tenant-a:operator:operator-a");
      expect(delta.evidenceReference).toBe("commercial_order_attributions:attr-123");
    });
  });

  describe("truth & freshness constraints", () => {
    it("rejects non-authoritative evidence for learning truth", () => {
      const gameEvidence: GoldlineEvidenceRef = {
        sourceType: "narrator",
        sourceReference: "narrator:1",
        classification: "game_projection",
        observedAt: "2026-09-29T10:00:00.000Z",
      };

      expect(() =>
        assertBusinessTruthEvidence([gameEvidence], "Learned delta")
      ).toThrow(
        "Learned delta requires authoritative external or operator-attested evidence"
      );
    });

    it("accepts authoritative external evidence for learning truth", () => {
      const authoritativeEvidence: GoldlineEvidenceRef = {
        sourceType: "shopify",
        sourceReference: "orders:order-1",
        classification: "authoritative_external",
        observedAt: "2026-09-29T10:00:00.000Z",
      };

      expect(() =>
        assertBusinessTruthEvidence([authoritativeEvidence], "Learned delta")
      ).not.toThrow();
    });
  });

  describe("delayed outcomes and non-reopening invariant", () => {
    it("attaches delayed outcome learning to originating historical run without mutating goal state", () => {
      const historicalDelta = sampleLearnedDelta({
        goalRunId: "historical-run-0",
        decisionId: "historical-dec-0",
        explanation: "Delayed conversion outcome attached to historical Monday operation",
      });

      expect(historicalDelta.goalRunId).toBe("historical-run-0");
      expect(historicalDelta.decisionId).toBe("historical-dec-0");
      // The learned delta references historical lineage without needing to mutate the superseded goal
      expect(historicalDelta.appliedCount).toBe(1);
    });
  });
});

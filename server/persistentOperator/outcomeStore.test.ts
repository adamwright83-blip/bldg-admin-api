import { describe, expect, it } from "vitest";
import {
  OUTCOME_IMPACT_CLASSES,
  EPISTEMIC_STATUSES,
  type GoalCycleOutcomeRecord,
} from "./outcomeStore";
import {
  assertBusinessTruthEvidence,
  type GoldlineEvidenceRef,
} from "../../shared/goldlineTruthContract";

function sampleOutcome(
  overrides: Partial<GoalCycleOutcomeRecord> = {}
): GoalCycleOutcomeRecord {
  return {
    id: "outcome-1",
    tenantId: "tenant-a",
    goalRunId: "run-1",
    cycleId: "cycle-1",
    decisionId: "dec-1",
    objectiveId: "obj-1",
    canonicalOperatorId: "tenant:tenant-a:operator:operator-a",
    operatorUserId: "operator-a",
    outcomeKind: "call_completed",
    impactClass: "action_verification",
    epistemicStatus: "verified",
    evidenceClass: "authoritative_external",
    evidenceReference: "communication_receipts:receipt-123",
    sourceSystem: "twilio",
    monetaryValueCents: null,
    quantityValue: null,
    unit: null,
    explanation: "Call verified completed via Twilio webhook",
    metadata: { durationSeconds: 120 },
    observedAt: "2026-09-29T10:05:00.000Z",
    createdAt: "2026-09-29T10:05:01.000Z",
    ...overrides,
  };
}

describe("Persistent Growth Outcome Store & Economic Accountability (Slice I)", () => {
  describe("outcome taxonomy and lineage", () => {
    it("distinguishes impact classes: action verification is distinct from commercial revenue", () => {
      expect(OUTCOME_IMPACT_CLASSES).toContain("action_verification");
      expect(OUTCOME_IMPACT_CLASSES).toContain("commercial_revenue");
      expect(OUTCOME_IMPACT_CLASSES).toContain("operational_result");
      expect(OUTCOME_IMPACT_CLASSES).toContain("customer_lifecycle");
    });

    it("distinguishes epistemic statuses", () => {
      expect(EPISTEMIC_STATUSES).toContain("verified");
      expect(EPISTEMIC_STATUSES).toContain("unverified");
      expect(EPISTEMIC_STATUSES).toContain("disputed");
      expect(EPISTEMIC_STATUSES).toContain("rejected");
    });

    it("preserves complete durable lineage across decision, objective, and evidence", () => {
      const outcome = sampleOutcome();
      expect(outcome.tenantId).toBe("tenant-a");
      expect(outcome.goalRunId).toBe("run-1");
      expect(outcome.cycleId).toBe("cycle-1");
      expect(outcome.decisionId).toBe("dec-1");
      expect(outcome.objectiveId).toBe("obj-1");
      expect(outcome.canonicalOperatorId).toBe("tenant:tenant-a:operator:operator-a");
      expect(outcome.evidenceReference).toBe("communication_receipts:receipt-123");
      expect(outcome.sourceSystem).toBe("twilio");
    });
  });

  describe("action verification vs. economic outcome separation", () => {
    it("action verification records that work was done without manufacturing economic credit", () => {
      const actionOutcome = sampleOutcome({
        outcomeKind: "verified_field_visit",
        impactClass: "action_verification",
        evidenceReference: "campaign_target_events:event-456",
        sourceSystem: "field_telemetry",
        monetaryValueCents: null,
      });

      expect(actionOutcome.impactClass).toBe("action_verification");
      expect(actionOutcome.monetaryValueCents).toBeNull();
      expect(actionOutcome.quantityValue).toBeNull();
    });

    it("economic outcome requires authoritative evidence and explicitly records commercial value", () => {
      const economicOutcome = sampleOutcome({
        outcomeKind: "paid_commercial_order",
        impactClass: "commercial_revenue",
        evidenceReference: "commercial_order_attributions:attr-789",
        sourceSystem: "commercial_order_attributions",
        monetaryValueCents: 45000,
        unit: "cents",
      });

      expect(economicOutcome.impactClass).toBe("commercial_revenue");
      expect(economicOutcome.monetaryValueCents).toBe(45000);
      expect(economicOutcome.unit).toBe("cents");
    });
  });

  describe("truth contract & financial review fail-closed enforcement", () => {
    it("rejects non-authoritative derived or game projection evidence for business truth", () => {
      const gameEvidence: GoldlineEvidenceRef = {
        sourceType: "narrator",
        sourceReference: "narrator:1",
        classification: "game_projection",
        observedAt: "2026-09-29T10:00:00.000Z",
      };

      expect(() =>
        assertBusinessTruthEvidence([gameEvidence], "Commercial revenue")
      ).toThrow(
        "Commercial revenue requires authoritative external or operator-attested evidence"
      );
    });

    it("accepts authoritative external and operator-attested evidence for business truth", () => {
      const authoritativeEvidence: GoldlineEvidenceRef = {
        sourceType: "shopify",
        sourceReference: "orders:123",
        classification: "authoritative_external",
        observedAt: "2026-09-29T10:00:00.000Z",
      };

      expect(() =>
        assertBusinessTruthEvidence([authoritativeEvidence], "Commercial revenue")
      ).not.toThrow();
    });
  });
});

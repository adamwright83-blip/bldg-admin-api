import { describe, expect, it } from "vitest";
import type {
  PersistentGrowthScoreboard,
  LoadoutDeltaExplainable,
  ExplainableHistoryItem,
} from "./proofReadModels";

describe("Persistent Growth Proof & Read Models (Slice K)", () => {
  describe("Authoritative Scoreboard structure", () => {
    it("distinguishes complete coverage from missing coverage without reporting fake zeros", () => {
      const scoreboardWithMissingCoverage: PersistentGrowthScoreboard = {
        tenantId: "tenant-a",
        canonicalOperatorId: "tenant:tenant-a:operator:operator-a",
        goalRunId: "run-1",
        metricKey: "accounts",
        targetValue: 10,
        unit: "accounts",
        authoritativeObservedValue: null,
        remainingGap: null,
        precision: "unknown",
        coverage: "unavailable",
        selectedWorkCount: 2,
        executedWorkCount: 1,
        awaitingEvidenceCount: 1,
        successfulOutcomesCount: 0,
        failedOutcomesCount: 0,
        unresolvedOutcomesCount: 1,
        attributableEconomicValueCents: null,
        economicPrecision: "none",
        learnedDeltasCount: 0,
        activeLearnedDeltas: [],
      };

      expect(scoreboardWithMissingCoverage.coverage).toBe("unavailable");
      expect(scoreboardWithMissingCoverage.authoritativeObservedValue).toBeNull();
      expect(scoreboardWithMissingCoverage.remainingGap).toBeNull();
      expect(scoreboardWithMissingCoverage.economicPrecision).toBe("none");
    });

    it("fails closed on conflicting economic outcome attribution", () => {
      const conflictingScoreboard: PersistentGrowthScoreboard = {
        tenantId: "tenant-a",
        canonicalOperatorId: "tenant:tenant-a:operator:operator-a",
        goalRunId: "run-1",
        metricKey: "revenue",
        targetValue: 1000,
        unit: "dollars",
        authoritativeObservedValue: 500,
        remainingGap: 500,
        precision: "recorded_only",
        coverage: "conflicting",
        selectedWorkCount: 5,
        executedWorkCount: 4,
        awaitingEvidenceCount: 1,
        successfulOutcomesCount: 2,
        failedOutcomesCount: 0,
        unresolvedOutcomesCount: 2,
        attributableEconomicValueCents: null, // Fails closed!
        economicPrecision: "conflicting",
        learnedDeltasCount: 1,
        activeLearnedDeltas: [
          {
            id: "delta-1",
            learningKind: "doctrine_weight",
            targetKey: "morning_outreach",
            deltaType: "boost",
            explanation: "Verified morning outreach success",
          },
        ],
      };

      expect(conflictingScoreboard.economicPrecision).toBe("conflicting");
      expect(conflictingScoreboard.attributableEconomicValueCents).toBeNull();
      expect(conflictingScoreboard.activeLearnedDeltas).toHaveLength(1);
    });

    it("accurately reports exact economic attribution when all evidence is authoritative and verified", () => {
      const exactScoreboard: PersistentGrowthScoreboard = {
        tenantId: "tenant-a",
        canonicalOperatorId: "tenant:tenant-a:operator:operator-a",
        goalRunId: "run-1",
        metricKey: "commercial_revenue",
        targetValue: 50000,
        unit: "cents",
        authoritativeObservedValue: 35000,
        remainingGap: 15000,
        precision: "exact",
        coverage: "complete",
        selectedWorkCount: 3,
        executedWorkCount: 3,
        awaitingEvidenceCount: 0,
        successfulOutcomesCount: 3,
        failedOutcomesCount: 0,
        unresolvedOutcomesCount: 0,
        attributableEconomicValueCents: 35000,
        economicPrecision: "exact",
        learnedDeltasCount: 2,
        activeLearnedDeltas: [],
      };

      expect(exactScoreboard.economicPrecision).toBe("exact");
      expect(exactScoreboard.attributableEconomicValueCents).toBe(35000);
      expect(exactScoreboard.remainingGap).toBe(15000);
    });
  });

  describe("LoadoutDelta explainable shape", () => {
    it("exposes structured machine-readable state and explainable evaluation", () => {
      const explainable: LoadoutDeltaExplainable = {
        deltaId: "delta-123",
        tenantId: "tenant-a",
        targetKey: "sales:door_to_door_dossier",
        learningKind: "doctrine_weight",
        deltaType: "boost",
        before: { weight: 1.0 },
        observedEvidenceOutcome: {
          outcomeId: "outcome-999",
          evidenceReference: "commercial_order_attributions:attr-456",
          confidence: "high",
        },
        evaluation: "Verified commercial revenue of $450.00 observed; boosting doctrine.",
        change: {
          deltaType: "boost",
          targetKey: "sales:door_to_door_dossier",
        },
        after: { weight: 1.5, verifiedRevenueCents: 45000 },
        createdAt: "2026-09-29T10:00:00.000Z",
      };

      expect(explainable.deltaId).toBe("delta-123");
      expect(explainable.change.deltaType).toBe("boost");
      expect(explainable.before?.weight).toBe(1.0);
      expect(explainable.after.weight).toBe(1.5);
      expect(explainable.observedEvidenceOutcome.confidence).toBe("high");
    });
  });

  describe("Explainable History item", () => {
    it("preserves continuous lineage from decision to learning delta", () => {
      const historyItem: ExplainableHistoryItem = {
        decisionId: "dec-1",
        goalRunId: "run-1",
        cycleId: "cycle-1",
        businessDate: "2026-09-29",
        selection: {
          kind: "obligation",
          selectedRef: "ob-1",
          executionType: "mission",
          reasonCode: "CANONICAL_FEED_FIRST_ELIGIBLE",
        },
        loadoutCount: 2,
        authority: {
          status: "resolved",
          basis: "standing_authorization",
        },
        objective: {
          id: "obj-1",
          title: "Visit Account",
          status: "completed",
        },
        verification: {
          status: "resolved",
          evidenceReference: "communication_receipts:receipt-1",
        },
        outcome: {
          status: "resolved",
          kind: "paid_commercial_order",
          monetaryValueCents: 50000,
        },
        learningDelta: {
          status: "resolved",
          deltaType: "boost",
          explanation: "Boosted based on verified order",
        },
        createdAt: "2026-09-29T10:00:00.000Z",
      };

      expect(historyItem.decisionId).toBe("dec-1");
      expect(historyItem.authority.basis).toBe("standing_authorization");
      expect(historyItem.objective?.status).toBe("completed");
      expect(historyItem.outcome.monetaryValueCents).toBe(50000);
      expect(historyItem.learningDelta.deltaType).toBe("boost");
    });
  });
});

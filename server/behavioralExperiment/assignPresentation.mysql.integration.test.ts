import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActionGrammar } from "../../shared/actionGrammar";
import { BEHAVIORAL_EXPERIMENT_POLICY_V1 } from "../../shared/behavioralExperimentPolicy";
import { FICTION_ELIGIBILITY_CATALOG } from "../../shared/fictionEligibilityCatalog";
import { assignExperimentalPresentation } from "./assignPresentation";
import { getDb } from "../db";

/**
 * Real-MySQL proof that MRT assignment is idempotent on (tenantId, idempotencyKey)
 * and records a genuine assignmentProbability. Runs only when DATABASE_URL is set
 * (CI goldline-fast-smoke integration step).
 */

const GRAMMAR: ActionGrammar = {
  kind: "VISIT_LOCATION",
  businessActionId: "42",
  occurrenceId: 42,
  sourceType: "recovery",
  count: 1,
  locations: ["100 Wilshire"],
  channel: "in_person",
  requiresTravel: true,
  requiresDriving: false,
  timerSafe: true,
  sensitiveConversation: false,
};

describe("experimental assignment — real MySQL", () => {
  it("concurrent assigns for one decision point persist a single probability", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const tenantId = `mrt-${randomUUID().slice(0, 8)}`;
    const occasionId = `offer-${randomUUID().slice(0, 8)}`;
    const policy = { ...BEHAVIORAL_EXPERIMENT_POLICY_V1, enabled: true };
    const [a, b] = await Promise.all([
      assignExperimentalPresentation({
        tenantId,
        operatorUserId: "operator-1",
        correlationId: "ops_task:9001",
        occasionId,
        grammar: GRAMMAR,
        registry: FICTION_ELIGIBILITY_CATALOG,
        policy,
      }),
      assignExperimentalPresentation({
        tenantId,
        operatorUserId: "operator-1",
        correlationId: "ops_task:9001",
        occasionId,
        grammar: GRAMMAR,
        registry: FICTION_ELIGIBILITY_CATALOG,
        policy,
      }),
    ]);
    expect(a.usedExperiment).toBe(true);
    expect(b.usedExperiment).toBe(true);
    expect(a.assignment?.assignedOption).toBe(b.assignment?.assignedOption);
    expect(a.assignment?.assignmentProbability).toBe(b.assignment?.assignmentProbability);
    expect(a.assignment?.assignmentProbability).toBeGreaterThan(0);
    expect(a.assignment?.assignmentProbability).toBeLessThanOrEqual(1);
    expect(a.assignment?.decisionPointId).toBe(b.assignment?.decisionPointId);
  }, 20000);
});

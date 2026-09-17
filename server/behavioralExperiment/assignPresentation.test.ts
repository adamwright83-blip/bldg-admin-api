import { describe, expect, it } from "vitest";
import type { ActionGrammar } from "../../shared/actionGrammar";
import type { FictionTemplate } from "../../shared/fictionTemplate";
import { STANDARD_PRESENTATION } from "../../shared/behavioralInterventionMapping";
import { BEHAVIORAL_EXPERIMENT_POLICY_V1 } from "../../shared/behavioralExperimentPolicy";
import { presentationDecisionPointId } from "../../shared/behavioralExperimentAssignment";
import { assignExperimentalPresentation } from "./assignPresentation";
import { characterizeProximalOutcome } from "./proximalOutcome";
import { describeRandomizedOutcomes } from "./experimentReport";
import type { BehavioralLedgerStore } from "../behavioralLedger/behavioralLedger";
import type { BehavioralLedgerEvent, InsertBehavioralLedgerEvent } from "../../drizzle/schema";
import { selectPreferredFictionPresentation } from "../../shared/behavioralFictionSelection";
import { preferredTemplateIdForDirector } from "../../shared/behavioralFictionSelection";

function createFakeStore(): BehavioralLedgerStore & { rows: BehavioralLedgerEvent[] } {
  const rows: BehavioralLedgerEvent[] = [];
  let nextId = 1;
  return {
    rows,
    async insertIfAbsent(input: InsertBehavioralLedgerEvent) {
      const existing = rows.find(
        r => r.tenantId === input.tenantId && r.idempotencyKey === input.idempotencyKey
      );
      if (existing) return existing;
      const row = { ...input, id: nextId++, createdAt: new Date() } as BehavioralLedgerEvent;
      rows.push(row);
      return row;
    },
    async listByCorrelation(tenantId, correlationId) {
      return rows.filter(r => r.tenantId === tenantId && r.correlationId === correlationId);
    },
    async listByDecisionPoint(tenantId, decisionPointId) {
      return rows.filter(r => r.tenantId === tenantId && r.decisionPointId === decisionPointId);
    },
  };
}

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

const WALK: FictionTemplate = {
  id: "beacon-walk-v1",
  rulesVersion: 1,
  compatibleGrammarKinds: ["VISIT_LOCATION"],
  title: "BEACON WALK",
  briefing: () => "x",
  physicalInstruction: () => "y",
  stakes: "z",
  successTreatment: { headline: "a", detail: "b" },
  failureTreatment: { headline: "c", detail: "d" },
  worldReturnTreatment: "w",
  timerEligible: false,
  drivingCompatible: false,
  attentionSafetyClass: "safe_walking",
  humanInteractionCompatible: false,
};

const SEALED: FictionTemplate = { ...WALK, id: "sealed-doors-v1" };
const UNSAFE: FictionTemplate = {
  ...WALK,
  id: "unsafe-timer-drive-v1",
  compatibleGrammarKinds: ["CALL_PERSON"],
  timerEligible: true,
  attentionSafetyClass: "unsafe_while_driving",
};

const ENABLED = { ...BEHAVIORAL_EXPERIMENT_POLICY_V1, enabled: true };

describe("assignExperimentalPresentation", () => {
  it("1. same decisionPointId is not randomized twice", async () => {
    const store = createFakeStore();
    const first = await assignExperimentalPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      correlationId: "ops_task:42",
      occasionId: "offer-1",
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      policy: ENABLED,
      store,
      randomInt: () => 1,
    });
    const second = await assignExperimentalPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      correlationId: "ops_task:42",
      occasionId: "offer-1",
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      policy: ENABLED,
      store,
      randomInt: () => 0,
    });
    expect(first.usedExperiment).toBe(true);
    expect(second.usedExperiment).toBe(true);
    expect(second.assignment?.assignedOption).toBe(first.assignment?.assignedOption);
    expect(store.rows.filter(row => row.decisionPointId === first.assignment?.decisionPointId)).toHaveLength(1);
  });

  it("2. reload returns the original assignment", async () => {
    const store = createFakeStore();
    const created = await assignExperimentalPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      correlationId: "ops_task:42",
      occasionId: "offer-1",
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      policy: ENABLED,
      store,
      randomInt: () => 2,
    });
    const reloaded = await assignExperimentalPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      correlationId: "ops_task:42",
      occasionId: "offer-1",
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      policy: ENABLED,
      store,
      randomInt: () => 0,
    });
    expect(reloaded.assignment).toEqual(created.assignment);
  });

  it("3. two decision points on the same subject may differ", async () => {
    const store = createFakeStore();
    const a = await assignExperimentalPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      correlationId: "ops_task:42",
      occasionId: "offer-a",
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      policy: ENABLED,
      store,
      randomInt: () => 0,
    });
    const b = await assignExperimentalPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      correlationId: "ops_task:42",
      occasionId: "offer-b",
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      policy: ENABLED,
      store,
      randomInt: () => 1,
    });
    expect(a.assignment?.decisionPointId).not.toBe(b.assignment?.decisionPointId);
    expect(a.assignment?.assignedOption).not.toBe(b.assignment?.assignedOption);
    expect(a.assignment?.correlationId).toBe("ops_task:42");
    expect(b.assignment?.correlationId).toBe("ops_task:42");
  });

  it("5/6/7/8. randomized probability, frozen eligible set, baseline, no unsafe arm", async () => {
    const store = createFakeStore();
    const result = await assignExperimentalPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      correlationId: "ops_task:42",
      occasionId: "offer-1",
      grammar: GRAMMAR,
      registry: [UNSAFE, WALK, SEALED],
      policy: ENABLED,
      store,
      randomInt: () => 0,
    });
    expect(result.usedExperiment).toBe(true);
    expect(result.assignment?.assignmentMechanism).toBe("randomized_assignment");
    expect(result.assignment?.assignmentProbability).toBeCloseTo(1 / 3);
    expect(result.assignment?.eligibleOptions).toEqual([
      STANDARD_PRESENTATION,
      "beacon-walk-v1",
      "sealed-doors-v1",
    ]);
    expect(result.assignment?.eligibleOptions).not.toContain("unsafe-timer-drive-v1");
    expect(result.assignment?.assignedOption).toBe(STANDARD_PRESENTATION);
    expect(result.assignment?.preferredTemplateId).toBeNull();
  });

  it("10. tenant isolation", async () => {
    const store = createFakeStore();
    await assignExperimentalPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      correlationId: "ops_task:42",
      occasionId: "offer-1",
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      policy: ENABLED,
      store,
      randomInt: () => 1,
    });
    const other = await assignExperimentalPresentation({
      tenantId: "tenant-b",
      operatorUserId: "op-a",
      correlationId: "ops_task:42",
      occasionId: "offer-1",
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      policy: ENABLED,
      store,
      randomInt: () => 0,
    });
    expect(other.assignment?.assignedOption).toBe(STANDARD_PRESENTATION);
    expect(store.rows.filter(row => row.tenantId === "tenant-a")).toHaveLength(1);
    expect(store.rows.filter(row => row.tenantId === "tenant-b")).toHaveLength(1);
  });

  it("11. client-supplied arm/probability cannot override server truth", async () => {
    const store = createFakeStore();
    const result = await assignExperimentalPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      correlationId: "ops_task:42",
      occasionId: "offer-1",
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      policy: ENABLED,
      store,
      clientAssignedOption: "unsafe-timer-drive-v1",
      clientAssignmentProbability: 0.99,
      randomInt: () => 0,
    });
    expect(result.assignment?.assignedOption).toBe(STANDARD_PRESENTATION);
    expect(result.assignment?.assignmentProbability).toBeCloseTo(1 / 3);
    expect(result.assignment?.assignedOption).not.toBe("unsafe-timer-drive-v1");
  });

  it("12. assignment is persisted before later outcomes", async () => {
    const store = createFakeStore();
    const assignedAt = new Date("2026-09-17T12:00:00Z");
    const result = await assignExperimentalPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      correlationId: "ops_task:42",
      occasionId: "offer-1",
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      policy: ENABLED,
      store,
      now: assignedAt,
      randomInt: () => 1,
    });
    expect(store.rows[0]?.occurredAt).toEqual(assignedAt);
    expect(store.rows[0]?.eventType).toBe("DELIVERED");
    expect(store.rows.some(row => row.eventType === "STARTED")).toBe(false);
    expect(result.assignment?.persisted).toBe(true);
  });

  it("20. disabled policy leaves Slice 4 fallback unchanged", async () => {
    const store = createFakeStore();
    const result = await assignExperimentalPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      correlationId: "ops_task:42",
      occasionId: "offer-1",
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      policy: BEHAVIORAL_EXPERIMENT_POLICY_V1,
      store,
      randomInt: () => 1,
    });
    expect(result.usedExperiment).toBe(false);
    expect(store.rows).toHaveLength(0);
    const slice4 = preferredTemplateIdForDirector({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      events: [],
    });
    expect(slice4.fromBehavioralSelector).toBe(false);
    const deterministic = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      events: [],
    });
    expect(deterministic.assignmentMechanism).toBe("deterministic_policy");
    expect(deterministic.assignmentProbability).toBeNull();
  });

  it("21. does not alter the ActionGrammar", async () => {
    const grammar = { ...GRAMMAR };
    const before = JSON.stringify(grammar);
    await assignExperimentalPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      correlationId: "ops_task:42",
      occasionId: "offer-1",
      grammar,
      registry: [WALK, SEALED],
      policy: ENABLED,
      store: createFakeStore(),
      randomInt: () => 1,
    });
    expect(JSON.stringify(grammar)).toBe(before);
  });
});

describe("proximal outcomes and reporting", () => {
  it("14/15. STARTED inside vs after the frozen window", () => {
    const assignedAt = new Date("2026-09-17T12:00:00Z");
    const inside = characterizeProximalOutcome({
      decisionPointId: "ops_task:42:offer:1",
      assignedOption: STANDARD_PRESENTATION,
      assignedAt,
      proximalOutcomeWindowMinutes: 60,
      deferredProducerExists: false,
      events: [
        { eventType: "DELIVERED", occurredAt: assignedAt },
        { eventType: "STARTED", occurredAt: new Date("2026-09-17T12:30:00Z") },
      ],
    });
    const after = characterizeProximalOutcome({
      decisionPointId: "ops_task:42:offer:1",
      assignedOption: STANDARD_PRESENTATION,
      assignedAt,
      proximalOutcomeWindowMinutes: 60,
      deferredProducerExists: false,
      events: [
        { eventType: "DELIVERED", occurredAt: assignedAt },
        { eventType: "STARTED", occurredAt: new Date("2026-09-17T14:00:00Z") },
      ],
    });
    expect(inside.startedWithinWindow).toBe(true);
    expect(after.startedWithinWindow).toBe(false);
    expect(inside.proximalOutcomeWindowMinutes).toBe(60);
    expect(after.windowFrozenAtAssignment).toBe(true);
  });

  it("16. no observed start is unknown, not IGNORED", () => {
    const outcome = characterizeProximalOutcome({
      decisionPointId: "dp",
      assignedOption: "beacon-walk-v1",
      assignedAt: new Date("2026-09-17T12:00:00Z"),
      proximalOutcomeWindowMinutes: 60,
      deferredProducerExists: false,
      events: [{ eventType: "DELIVERED", occurredAt: new Date("2026-09-17T12:00:00Z") }],
    });
    expect(outcome.startedWithinWindow).toBe("unknown");
    expect(JSON.stringify(outcome)).not.toMatch(/ignored/i);
  });

  it("17. no DEFERRED producer means deferral is unavailable", () => {
    const outcome = characterizeProximalOutcome({
      decisionPointId: "dp",
      assignedOption: "beacon-walk-v1",
      assignedAt: new Date("2026-09-17T12:00:00Z"),
      proximalOutcomeWindowMinutes: 60,
      deferredProducerExists: false,
      events: [
        { eventType: "DELIVERED", occurredAt: new Date("2026-09-17T12:00:00Z") },
        { eventType: "DISMISSED", occurredAt: new Date("2026-09-17T12:10:00Z") },
        { eventType: "EXPIRED", occurredAt: new Date("2026-09-17T13:00:00Z") },
        { eventType: "NOT_COMPLETED", occurredAt: new Date("2026-09-17T13:00:00Z") },
      ],
    });
    expect(outcome.deferredSignal).toBe("unavailable");
    expect(outcome.deferredWithinWindow).toBe("unavailable");
  });

  it("18/19. report never claims works-better and small n is insufficient", () => {
    const assignedAt = new Date("2026-09-17T12:00:00Z");
    const outcomes = [
      characterizeProximalOutcome({
        decisionPointId: "a",
        assignedOption: STANDARD_PRESENTATION,
        assignedAt,
        proximalOutcomeWindowMinutes: 60,
        deferredProducerExists: false,
        events: [{ eventType: "DELIVERED", occurredAt: assignedAt }],
      }),
    ];
    const report = describeRandomizedOutcomes({
      outcomes,
      minSamplePerArm: 20,
      deferredProducerExists: false,
    });
    expect(report.kind).toBe("observed_randomized_outcomes_by_arm");
    expect(report.causalProductClaim).toBe("insufficient_evidence_for_a_causal_product_claim");
    expect(report.insufficientSample).toBe(true);
    expect(report.deferredBurden).toBe("unavailable");
    expect(JSON.stringify(report)).not.toMatch(/works better|caused|lift|significant/i);
  });

  it("13. events before the decision point are not counted as starts", () => {
    const assignedAt = new Date("2026-09-17T12:00:00Z");
    const outcome = characterizeProximalOutcome({
      decisionPointId: "dp",
      assignedOption: "beacon-walk-v1",
      assignedAt,
      proximalOutcomeWindowMinutes: 60,
      deferredProducerExists: false,
      events: [
        { eventType: "STARTED", occurredAt: new Date("2026-09-17T11:00:00Z") },
        { eventType: "DELIVERED", occurredAt: assignedAt },
      ],
    });
    expect(outcome.startedAt).toBeNull();
    expect(outcome.startedWithinWindow).toBe("unknown");
  });
});

describe("decision point identity", () => {
  it("subject and occasion remain distinct", () => {
    expect(presentationDecisionPointId({ correlationId: "ops_task:42", occasionId: "101" })).toBe(
      "ops_task:42:offer:101"
    );
  });
});

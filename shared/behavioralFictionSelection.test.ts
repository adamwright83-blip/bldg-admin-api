import { describe, expect, it } from "vitest";
import type { ActionGrammar } from "./actionGrammar";
import { deriveFictionAssignment } from "./fictionTemplate";
import { DIAGNOSIS_FORBIDDEN_PATTERNS } from "./behavioralInterventionMapping";
import {
  selectPreferredFictionPresentation,
  selectionTextIsEpistemicallySafe,
} from "./behavioralFictionSelection";
import type { FictionTemplate } from "./fictionTemplate";
import type { BehavioralLedgerLikeEvent } from "./behavioralEvidence";
import { opsTaskBehavioralSubject } from "./behavioralSubject";

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

const PLAIN: FictionTemplate = {
  id: "beacon-walk-v1",
  rulesVersion: 1,
  compatibleGrammarKinds: ["VISIT_LOCATION"],
  title: "BEACON WALK",
  briefing: () => "Visit the real site.",
  physicalInstruction: () => "Visit 100 Wilshire and record the result.",
  stakes: "Evidence only.",
  successTreatment: { headline: "OK", detail: "Recorded." },
  failureTreatment: { headline: "NO", detail: "Unchanged." },
  worldReturnTreatment: "walked",
  timerEligible: false,
  drivingCompatible: false,
  attentionSafetyClass: "safe_walking",
  humanInteractionCompatible: false,
};

const RESCUE: FictionTemplate = {
  ...PLAIN,
  id: "sealed-doors-v1",
  title: "SEALED DOORS",
};

const UNSAFE: FictionTemplate = {
  ...PLAIN,
  id: "unsafe-timer-drive-v1",
  title: "UNSAFE",
  compatibleGrammarKinds: ["CALL_PERSON"],
  timerEligible: true,
  drivingCompatible: false,
  attentionSafetyClass: "unsafe_while_driving",
};

const REGISTRY = [UNSAFE, RESCUE, PLAIN];

/** Realistic Slice 1 ops-task mirror rows: distinct sourceEntityIds, shared correlation. */
function mirroredOpsEvents(
  taskId: number,
  rows: Array<{
    type: BehavioralLedgerLikeEvent["eventType"];
    tenant?: string;
    operator?: string;
    eventId?: number;
  }>
): BehavioralLedgerLikeEvent[] {
  return rows.map((row, index) => ({
    tenantId: row.tenant ?? "tenant-a",
    operatorUserId: row.operator ?? "op-a",
    sourceEntityId: String(row.eventId ?? 8000 + taskId * 10 + index),
    correlationId: opsTaskBehavioralSubject(taskId),
    eventType: row.type,
  }));
}

function provenanceBlob(decision: ReturnType<typeof selectPreferredFictionPresentation>): string {
  return JSON.stringify(decision);
}

describe("Slice 4: barrier → intervention → fiction selection", () => {
  it("1. realistic mirrored ops-task rows with distinct sourceEntityIds still aggregate", () => {
    const events = mirroredOpsEvents(42, [
      { type: "DELIVERED", eventId: 101 },
      { type: "ACCEPTED", eventId: 102 },
      { type: "STARTED", eventId: 103 },
      { type: "DEFERRED", eventId: 104 },
      { type: "DEFERRED", eventId: 105 },
    ]);
    const sourceIds = new Set(events.map(item => item.sourceEntityId));
    expect(sourceIds.size).toBe(5);
    expect(new Set(events.map(item => item.correlationId))).toEqual(new Set(["ops_task:42"]));

    const none = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar: GRAMMAR,
      registry: REGISTRY,
      events: mirroredOpsEvents(42, [{ type: "DELIVERED", eventId: 90 }]),
    });
    const deferred = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar: GRAMMAR,
      registry: REGISTRY,
      events,
    });
    expect(none.preferredTemplateId).toBeNull();
    expect(deferred.preferredTemplateId).toBeTruthy();
    expect(deferred.evidence.counts.deferred).toBe(2);
    expect(["beacon-walk-v1", "sealed-doors-v1"]).toContain(deferred.preferredTemplateId);
    expect(deferred.eligibleFictionTemplateIds).not.toContain("unsafe-timer-drive-v1");
    expect(deferred.barrierHypothesis.label).toBe("possible scheduling/opportunity friction");
    expect(deferred.barrierHypothesis.source).toBe("behavior-observed");
    expect(deferred.assignmentMechanism).toBe("deterministic_policy");
    expect(deferred.assignmentProbability).toBeNull();
    const blob = provenanceBlob(deferred);
    for (const pattern of DIAGNOSIS_FORBIDDEN_PATTERNS) {
      expect(blob).not.toMatch(pattern);
    }
    expect(selectionTextIsEpistemicallySafe(deferred.claireSafeExplanation)).toBe(true);
  });

  it("2. explicit operator declaration outranks inference and may name time", () => {
    const decision = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar: GRAMMAR,
      registry: REGISTRY,
      events: mirroredOpsEvents(42, [
        { type: "DELIVERED", eventId: 1 },
        { type: "DEFERRED", eventId: 2 },
        { type: "DEFERRED", eventId: 3 },
        { type: "DEFERRED", eventId: 4 },
      ]),
      declaredBarriers: [{ key: "time", statement: "I only have ten minutes before the route." }],
    });
    expect(decision.barrierHypothesis.source).toBe("operator-declared");
    expect(decision.barrierHypothesis.label).toBe("declared time constraint");
    expect(decision.preferredTemplateId).toBeNull();
    expect(decision.assignedOption).toBe("STANDARD_PRESENTATION");
    expect(decision.assignmentProbability).toBeNull();
    expect(decision.evidence.declaredBarriers[0]?.statement).toContain("ten minutes");
    expect(decision.selectionReason).toContain("outranks");
    expect(decision.claireSafeExplanation).toContain("time is the constraint");
  });

  it("3. insufficient evidence does not fabricate a barrier", () => {
    const decision = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar: GRAMMAR,
      registry: REGISTRY,
      events: [],
    });
    expect(decision.barrierHypothesis.present).toBe(false);
    expect(decision.barrierHypothesis.label).toBe("insufficient evidence");
    expect(decision.preferredTemplateId).toBeNull();
    expect(decision.intervention).toBeNull();
    expect(decision.assignmentMechanism).toBe("deterministic_policy");
    expect(decision.assignmentProbability).toBeNull();
  });

  it("4. eligibility outranks preference — unsafe templates stay out", () => {
    const drivingGrammar: ActionGrammar = { ...GRAMMAR, requiresDriving: true, timerSafe: false };
    const drivingUnsafe: FictionTemplate = {
      ...UNSAFE,
      compatibleGrammarKinds: ["VISIT_LOCATION"],
    };
    const decision = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar: drivingGrammar,
      registry: [drivingUnsafe, RESCUE, PLAIN],
      events: mirroredOpsEvents(42, [
        { type: "DEFERRED", eventId: 11 },
        { type: "DEFERRED", eventId: 12 },
      ]),
    });
    expect(decision.eligibleFictionTemplateIds).not.toContain("unsafe-timer-drive-v1");
    expect(decision.preferredTemplateId).not.toBe("unsafe-timer-drive-v1");
    expect(decision.assignedOption).not.toBe("unsafe-timer-drive-v1");
  });

  it("5. real task / grammar stays unchanged", () => {
    const grammar = { ...GRAMMAR };
    const before = JSON.stringify(grammar);
    const decision = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar,
      registry: REGISTRY,
      events: mirroredOpsEvents(42, [
        { type: "DEFERRED", eventId: 21 },
        { type: "DEFERRED", eventId: 22 },
      ]),
    });
    expect(JSON.stringify(grammar)).toBe(before);
    expect(decision.businessActionId).toBe("42");
    expect(decision.grammarKind).toBe("VISIT_LOCATION");
    expect(decision.correlationId).toBe("ops_task:42");
  });

  it("6. same task can receive different eligible presentations from different evidence", () => {
    const light = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar: GRAMMAR,
      registry: REGISTRY,
      decisionPointId: "dp-light",
      events: mirroredOpsEvents(42, [
        { type: "DEFERRED", eventId: 31 },
        { type: "DEFERRED", eventId: 32 },
      ]),
    });
    const heavy = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar: GRAMMAR,
      registry: REGISTRY,
      decisionPointId: "dp-heavy",
      events: mirroredOpsEvents(42, [
        { type: "DELIVERED", eventId: 41 },
        { type: "DELIVERED", eventId: 42 },
        { type: "DELIVERED", eventId: 43 },
        { type: "DELIVERED", eventId: 44 },
        { type: "DEFERRED", eventId: 45 },
        { type: "DEFERRED", eventId: 46 },
      ]),
    });
    expect(light.preferredTemplateId).toBeTruthy();
    expect(heavy.preferredTemplateId).toBeTruthy();
    expect(light.businessActionId).toBe(heavy.businessActionId);
    expect(light.preferredTemplateId).not.toBe(heavy.preferredTemplateId);
    expect(light.eligibleFictionTemplateIds).toEqual(heavy.eligibleFictionTemplateIds);
    expect(light.assignmentProbability).toBeNull();
    expect(heavy.assignmentProbability).toBeNull();
  });

  it("7. provenance does not claim causal effectiveness or fake 1/N probability", () => {
    const decision = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar: GRAMMAR,
      registry: REGISTRY,
      events: mirroredOpsEvents(42, [
        { type: "DEFERRED", eventId: 51 },
        { type: "DEFERRED", eventId: 52 },
      ]),
    });
    expect(decision.selectionReason).toContain("Not randomized assignment");
    expect(decision.assignmentMechanism).toBe("deterministic_policy");
    expect(decision.assignmentProbability).toBeNull();
    expect(decision.intervention?.annotationStatus).toBe("proposed");
    expect(selectionTextIsEpistemicallySafe(provenanceBlob(decision))).toBe(true);
  });

  it("8. tenant/operator isolation and no cross-task bleed", () => {
    const otherTask = mirroredOpsEvents(99, [
      { type: "DEFERRED", eventId: 901 },
      { type: "DEFERRED", eventId: 902 },
    ]);
    const decision = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar: GRAMMAR,
      registry: REGISTRY,
      events: [
        ...mirroredOpsEvents(42, [{ type: "DELIVERED", eventId: 61, tenant: "tenant-b" }]),
        ...mirroredOpsEvents(42, [
          { type: "DEFERRED", eventId: 62, tenant: "tenant-b" },
          { type: "DEFERRED", eventId: 63, tenant: "tenant-b" },
          { type: "DEFERRED", eventId: 64, operator: "op-other" },
          { type: "DEFERRED", eventId: 65, operator: "op-other" },
        ]),
        ...otherTask,
        ...mirroredOpsEvents(42, [{ type: "DELIVERED", eventId: 66 }]),
      ],
    });
    expect(decision.evidence.counts.deferred).toBe(0);
    expect(decision.preferredTemplateId).toBeNull();
    expect(decision.barrierHypothesis.present).toBe(false);
  });

  it("9. completed history remains immutable", () => {
    const history = mirroredOpsEvents(42, [
      { type: "COMPLETED", eventId: 71 },
      { type: "VERIFIED", eventId: 72 },
      { type: "DEFERRED", eventId: 73 },
      { type: "DEFERRED", eventId: 74 },
    ]);
    const snapshot = JSON.stringify(history);
    selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar: GRAMMAR,
      registry: REGISTRY,
      events: history,
    });
    expect(JSON.stringify(history)).toBe(snapshot);
    expect(history.filter(item => item.eventType === "COMPLETED")).toHaveLength(1);
  });

  it("10. existing fallback still works when history is empty", () => {
    const decision = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar: GRAMMAR,
      registry: REGISTRY,
      events: [],
    });
    expect(decision.preferredTemplateId).toBeNull();
    const bound = deriveFictionAssignment("stable:contact-dormant-customer-77", [PLAIN, RESCUE], GRAMMAR);
    expect(bound?.templateId).toMatch(/beacon-walk-v1|sealed-doors-v1/);
    expect(GRAMMAR.businessActionId).toBe("42");
  });

  it("11. NOT_COMPLETED, DISMISSED, EXPIRED, and silence never manufacture DEFERRED", () => {
    const decision = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar: GRAMMAR,
      registry: REGISTRY,
      events: mirroredOpsEvents(42, [
        { type: "DELIVERED", eventId: 81 },
        { type: "NOT_COMPLETED", eventId: 82 },
        { type: "DISMISSED", eventId: 83 },
        { type: "EXPIRED", eventId: 84 },
      ]),
    });
    expect(decision.evidence.counts.deferred).toBe(0);
    expect(decision.evidence.counts.notCompleted).toBe(1);
    expect(decision.evidence.counts.dismissed).toBe(1);
    expect(decision.evidence.counts.expired).toBe(1);
    expect(decision.preferredTemplateId).toBeNull();
    expect(decision.barrierHypothesis.present).toBe(false);
  });
});

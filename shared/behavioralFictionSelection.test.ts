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

const GRAMMAR: ActionGrammar = {
  kind: "VISIT_LOCATION",
  businessActionId: "contact-dormant-customer-77",
  occurrenceId: 77,
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

function events(
  rows: Array<{ type: BehavioralLedgerLikeEvent["eventType"]; tenant?: string; operator?: string; task?: string }>
): BehavioralLedgerLikeEvent[] {
  return rows.map((row, index) => ({
    tenantId: row.tenant ?? "tenant-a",
    operatorUserId: row.operator ?? "op-a",
    sourceEntityId: row.task ?? "contact-dormant-customer-77",
    eventType: row.type,
    correlationId: `c-${index}`,
  }));
}

function provenanceBlob(decision: ReturnType<typeof selectPreferredFictionPresentation>): string {
  return JSON.stringify(decision);
}

describe("Slice 4: barrier → intervention → fiction selection", () => {
  it("1. repeated deferral can change presentation without diagnosing the operator", () => {
    const none = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      sourceEntityId: GRAMMAR.businessActionId!,
      grammar: GRAMMAR,
      registry: REGISTRY,
      events: events([{ type: "DELIVERED" }]),
    });
    const deferred = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      sourceEntityId: GRAMMAR.businessActionId!,
      grammar: GRAMMAR,
      registry: REGISTRY,
      events: events([
        { type: "DELIVERED" },
        { type: "DELIVERED" },
        { type: "DELIVERED" },
        { type: "DEFERRED" },
        { type: "DEFERRED" },
      ]),
    });
    expect(none.preferredTemplateId).toBeNull();
    expect(deferred.preferredTemplateId).toBeTruthy();
    expect(["beacon-walk-v1", "sealed-doors-v1"]).toContain(deferred.preferredTemplateId);
    expect(deferred.eligibleFictionTemplateIds).not.toContain("unsafe-timer-drive-v1");
    const blob = provenanceBlob(deferred);
    for (const pattern of DIAGNOSIS_FORBIDDEN_PATTERNS) {
      expect(blob).not.toMatch(pattern);
    }
    expect(deferred.barrierHypothesis.label).toBe("possible opportunity/time friction");
    expect(deferred.barrierHypothesis.source).toBe("behavior-observed");
    expect(deferred.claireSafeExplanation).toContain("deferred it 2 times");
    expect(selectionTextIsEpistemicallySafe(deferred.claireSafeExplanation)).toBe(true);
  });

  it("2. explicit operator declaration outranks inference", () => {
    const decision = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      sourceEntityId: GRAMMAR.businessActionId!,
      grammar: GRAMMAR,
      registry: REGISTRY,
      events: events([
        { type: "DELIVERED" },
        { type: "DEFERRED" },
        { type: "DEFERRED" },
        { type: "DEFERRED" },
      ]),
      declaredBarriers: [{ key: "time", statement: "I only have ten minutes before the route." }],
    });
    expect(decision.barrierHypothesis.source).toBe("operator-declared");
    expect(decision.preferredTemplateId).toBeNull();
    expect(decision.assignedOption).toBe("STANDARD_PRESENTATION");
    expect(decision.evidence.declaredBarriers[0]?.statement).toContain("ten minutes");
    expect(decision.selectionReason).toContain("outranks");
    expect(decision.claireSafeExplanation).toContain("time is the constraint");
  });

  it("3. insufficient evidence does not fabricate a barrier", () => {
    const decision = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      sourceEntityId: GRAMMAR.businessActionId!,
      grammar: GRAMMAR,
      registry: REGISTRY,
      events: [],
    });
    expect(decision.barrierHypothesis.present).toBe(false);
    expect(decision.barrierHypothesis.label).toBe("insufficient evidence");
    expect(decision.preferredTemplateId).toBeNull();
    expect(decision.intervention).toBeNull();
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
      sourceEntityId: GRAMMAR.businessActionId!,
      grammar: drivingGrammar,
      registry: [drivingUnsafe, RESCUE, PLAIN],
      events: events([{ type: "DEFERRED" }, { type: "DEFERRED" }]),
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
      sourceEntityId: GRAMMAR.businessActionId!,
      grammar,
      registry: REGISTRY,
      events: events([{ type: "DEFERRED" }, { type: "DEFERRED" }]),
    });
    expect(JSON.stringify(grammar)).toBe(before);
    expect(decision.businessActionId).toBe("contact-dormant-customer-77");
    expect(decision.grammarKind).toBe("VISIT_LOCATION");
  });

  it("6. same task can receive different eligible presentations", () => {
    const light = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      sourceEntityId: GRAMMAR.businessActionId!,
      grammar: GRAMMAR,
      registry: REGISTRY,
      decisionPointId: "dp-light",
      events: events([{ type: "DEFERRED" }, { type: "DEFERRED" }]),
    });
    const heavy = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      sourceEntityId: GRAMMAR.businessActionId!,
      grammar: GRAMMAR,
      registry: REGISTRY,
      decisionPointId: "dp-heavy",
      events: events([
        { type: "DELIVERED" },
        { type: "DELIVERED" },
        { type: "DELIVERED" },
        { type: "DELIVERED" },
        { type: "DEFERRED" },
        { type: "DEFERRED" },
      ]),
    });
    expect(light.preferredTemplateId).toBeTruthy();
    expect(heavy.preferredTemplateId).toBeTruthy();
    expect(light.businessActionId).toBe(heavy.businessActionId);
    expect(light.preferredTemplateId).not.toBe(heavy.preferredTemplateId);
    expect(light.eligibleFictionTemplateIds).toEqual(heavy.eligibleFictionTemplateIds);
  });

  it("7. provenance does not claim causal effectiveness", () => {
    const decision = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      sourceEntityId: GRAMMAR.businessActionId!,
      grammar: GRAMMAR,
      registry: REGISTRY,
      events: events([{ type: "DEFERRED" }, { type: "DEFERRED" }]),
    });
    expect(decision.selectionReason).toContain("Not a causal ranking");
    expect(decision.intervention?.annotationStatus).toBe("proposed");
    expect(selectionTextIsEpistemicallySafe(provenanceBlob(decision))).toBe(true);
  });

  it("8. tenant/operator isolation", () => {
    const decision = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      sourceEntityId: GRAMMAR.businessActionId!,
      grammar: GRAMMAR,
      registry: REGISTRY,
      events: events([
        { type: "DEFERRED", tenant: "tenant-b" },
        { type: "DEFERRED", tenant: "tenant-b" },
        { type: "DEFERRED", operator: "op-other" },
        { type: "DEFERRED", operator: "op-other" },
        { type: "DEFERRED", task: "other-task" },
        { type: "DEFERRED", task: "other-task" },
        { type: "DELIVERED" },
      ]),
    });
    expect(decision.evidence.counts.deferred).toBe(0);
    expect(decision.preferredTemplateId).toBeNull();
    expect(decision.barrierHypothesis.present).toBe(false);
  });

  it("9. completed history remains immutable", () => {
    const history = events([
      { type: "COMPLETED" },
      { type: "VERIFIED" },
      { type: "DEFERRED" },
      { type: "DEFERRED" },
    ]);
    const snapshot = JSON.stringify(history);
    selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      sourceEntityId: GRAMMAR.businessActionId!,
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
      sourceEntityId: GRAMMAR.businessActionId!,
      grammar: GRAMMAR,
      registry: REGISTRY,
      events: [],
    });
    expect(decision.preferredTemplateId).toBeNull();
    const bound = deriveFictionAssignment("stable:contact-dormant-customer-77", [PLAIN, RESCUE], GRAMMAR);
    expect(bound?.templateId).toMatch(/beacon-walk-v1|sealed-doors-v1/);
    expect(GRAMMAR.businessActionId).toBe("contact-dormant-customer-77");
  });
});

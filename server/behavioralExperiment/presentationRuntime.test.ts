import { describe, expect, it } from "vitest";
import type { ActionGrammar } from "../../shared/actionGrammar";
import { behavioralSubjectFromGrammar } from "../../shared/behavioralSubject";
import { BEHAVIORAL_EXPERIMENT_POLICY_V1 } from "../../shared/behavioralExperimentPolicy";
import type { BehavioralLedgerEvent } from "../../drizzle/schema";
import type { BehavioralLedgerStore } from "../behavioralLedger/behavioralLedger";
import { acknowledgePresentationViewable, assignAuthorizedPresentation, type PresentationRuntimePorts } from "./presentationRuntime";

const grammar: ActionGrammar = { kind: "FOLLOW_UP_PERSON", businessActionId: "objective:1", occurrenceId: null,
  sourceType: "follow_up", count: 1, locations: [], channel: "phone", requiresTravel: false, requiresDriving: false, timerSafe: false, sensitiveConversation: true };
function setup() {
  const rows: BehavioralLedgerEvent[] = [];
  let consent = true;
  let canonical: ActionGrammar | null = grammar;
  const store: BehavioralLedgerStore = {
    async insertIfAbsent(input) {
      const prior = rows.find(row => row.tenantId === input.tenantId && row.idempotencyKey === input.idempotencyKey);
      if (prior) return prior;
      const row = { ...input, id: rows.length + 1, createdAt: new Date() } as BehavioralLedgerEvent;
      rows.push(row); return row;
    },
    async listByCorrelation(tenant, subject) { return rows.filter(row => row.tenantId === tenant && row.correlationId === subject); },
    async listByDecisionPoint(tenant, point) { return rows.filter(row => row.tenantId === tenant && row.decisionPointId === point); },
    async listByOperatorBounded(tenant, operators) { return rows.filter(row => row.tenantId === tenant && operators.includes(row.operatorUserId)).reverse(); },
  };
  const ports: PresentationRuntimePorts = { store, randomInt: () => 1, policy: { ...BEHAVIORAL_EXPERIMENT_POLICY_V1, enabled: true },
    loadConsent: async () => ({ adaptationAllowed: consent, experimentationAllowed: consent, evidenceRefs: consent ? ["pref:1", "experiment:1"] : ["revoked:2"] }),
    loadDeclaredPlainPresentation: async () => null,
    loadGrammar: async () => canonical };
  return { rows, ports, revoke: () => { consent = false; }, loseWork: () => { canonical = null; } };
}
const input = { tenantId: "tenant-a", operatorUserId: "operator-a", correlationId: behavioralSubjectFromGrammar(grammar), occasionId: "chapter-a" };
describe("authorized production presentation runtime", () => {
  it("persists selection before use, reports a real surface separately, and deduplicates replay", async () => {
    const { rows, ports } = setup();
    const chosen = await assignAuthorizedPresentation(input, ports);
    expect(chosen.usedExperiment).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe("ASSIGNED");
    expect(rows.some(row => row.eventType === "DELIVERED" || row.eventType === "VIEWABLE")).toBe(false);
    if (!chosen.usedExperiment) throw new Error("missing assignment");
    const acknowledgment = { ...input, decisionPointId: chosen.assignment.decisionPointId, templateId: chosen.assignment.preferredTemplateId! };
    await acknowledgePresentationViewable(acknowledgment, ports);
    await acknowledgePresentationViewable(acknowledgment, ports);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ eventType: "VIEWABLE", verificationClass: "CLAIMED" });
    expect(rows.some(row => ["STARTED", "COMPLETED", "VERIFIED"].includes(row.eventType))).toBe(false);
    const restarted = await assignAuthorizedPresentation(input, { ...ports, randomInt: () => 0 });
    expect(restarted.assignment).toEqual(chosen.assignment);
  });
  it("rereads consent before replay and render acknowledgment", async () => {
    const { rows, ports, revoke } = setup();
    const chosen = await assignAuthorizedPresentation(input, ports);
    if (!chosen.usedExperiment) throw new Error("missing assignment");
    revoke();
    expect(await assignAuthorizedPresentation(input, ports)).toMatchObject({ usedExperiment: false, skipReason: "fresh_operator_experimentation_consent_required" });
    await expect(acknowledgePresentationViewable({ ...input, decisionPointId: chosen.assignment.decisionPointId, templateId: chosen.assignment.preferredTemplateId! }, ports)).rejects.toThrow("consent");
    expect(rows).toHaveLength(1);
  });
  it("refuses unrelated work, unknown canonical grammar, and forged template reports", async () => {
    const { rows, ports, loseWork } = setup();
    expect((await assignAuthorizedPresentation({ ...input, correlationId: "ops_task:other" }, ports)).usedExperiment).toBe(false);
    const chosen = await assignAuthorizedPresentation(input, ports);
    if (!chosen.usedExperiment) throw new Error("missing assignment");
    await expect(acknowledgePresentationViewable({ ...input, decisionPointId: chosen.assignment.decisionPointId, templateId: "unapproved" }, ports)).rejects.toThrow("approved assignment");
    await expect(acknowledgePresentationViewable({ ...input, operatorUserId: "other", decisionPointId: chosen.assignment.decisionPointId, templateId: chosen.assignment.preferredTemplateId! }, ports)).rejects.toThrow("approved assignment");
    loseWork();
    expect((await assignAuthorizedPresentation(input, ports)).usedExperiment).toBe(false);
    expect(rows).toHaveLength(1);
  });
  it("closes the loop: joined skips of story arms throttle the next occasion to a recorded baseline", async () => {
    const { rows, ports } = setup();
    const subject = "ops_task:88";
    const visit: ActionGrammar = { kind: "VISIT_LOCATION", businessActionId: "88", occurrenceId: 88, sourceType: "recovery", count: 1,
      locations: ["100 Wilshire"], channel: "in_person", requiresTravel: true, requiresDriving: false, timerSafe: true, sensitiveConversation: false };
    const runtime: PresentationRuntimePorts = { ...ports, loadGrammar: async () => visit };
    const scope = { tenantId: "tenant-a", operatorUserId: "operator-a", correlationId: subject };
    const dismiss = (minute: number) => ports.store!.insertIfAbsent({ tenantId: "tenant-a", operatorUserId: "operator-a", correlationId: subject,
      sourceSystem: "ops_task", sourceEntityType: "ops_task_event", sourceEntityId: `e${minute}`, eventType: "DISMISSED",
      occurredAt: new Date(Date.UTC(2026, 9, 12, 16, minute)), verificationClass: null, provenance: "ops_task_event",
      evidenceSource: null, idempotencyKey: `dismiss:${minute}` } as never);
    for (const [occasion, minute] of [["o1", 0], ["o2", 20]] as const) {
      const chosen = await assignAuthorizedPresentation({ ...scope, occasionId: occasion, now: new Date(Date.UTC(2026, 9, 12, 16, minute)) }, runtime);
      expect(chosen).toMatchObject({ usedExperiment: true, assignment: { availability: true, assignmentMechanism: "randomized_assignment" } });
      expect(chosen.assignment?.assignedOption).not.toBe("STANDARD_PRESENTATION");
      await dismiss(minute + 5);
    }
    const third = await assignAuthorizedPresentation({ ...scope, occasionId: "o3", now: new Date(Date.UTC(2026, 9, 12, 17, 0)) }, runtime);
    expect(third).toMatchObject({ usedExperiment: true, assignment: { availability: false, assignmentMechanism: "fatigue_throttle",
      assignedOption: "STANDARD_PRESENTATION", assignmentProbability: null, preferredTemplateId: null } });
    const recorded = rows.filter(row => row.eventType === "ASSIGNED");
    expect(recorded).toHaveLength(3);
    expect(recorded[2]).toMatchObject({ availability: false, assignedOption: "STANDARD_PRESENTATION", assignmentProbability: null,
      interventionPolicyVersion: 1, interventionDefinitionVersion: 1, proximalOutcomeWindowMinutes: 120 });
    expect(recorded[2].provenance).toContain("daphne_fatigue_throttle:burden_skip_threshold_exceeded");
    expect(recorded[2].eligibleOptionsJson).toContain("STANDARD_PRESENTATION");
    // Replays of the throttled occasion return the same recorded baseline.
    expect((await assignAuthorizedPresentation({ ...scope, occasionId: "o3" }, { ...runtime, randomInt: () => 0 })).assignment).toEqual(third.assignment);
    expect(rows.filter(row => row.eventType === "ASSIGNED")).toHaveLength(3);
  });
  it("records a declared plain request as an unavailable baseline decision", async () => {
    const { rows, ports } = setup();
    const chosen = await assignAuthorizedPresentation(input, { ...ports, loadDeclaredPlainPresentation: async () => ({ sourceRef: "daphne_observations:plain-1" }) });
    expect(chosen).toMatchObject({ usedExperiment: true, assignment: { availability: false, preferredTemplateId: null } });
    expect(rows[0]).toMatchObject({ availability: false, assignedOption: "STANDARD_PRESENTATION", evidenceSource: "daphne_evidence:daphne_observations:plain-1" });
    if (!chosen.usedExperiment) throw new Error("missing assignment");
    const viewable = await acknowledgePresentationViewable({ ...input, decisionPointId: chosen.assignment.decisionPointId, templateId: "STANDARD_PRESENTATION" }, ports);
    expect(viewable.recorded).toBe(true);
    expect(rows.some(row => row.eventType === "VIEWABLE" && row.assignedOption === "STANDARD_PRESENTATION")).toBe(true);
  });
  it("keeps a declared plain preference when experimentation is off, including a disabled experiment policy", async () => {
    const { rows, ports, revoke } = setup();
    revoke();
    const withoutConsent = await assignAuthorizedPresentation(input, { ...ports, loadDeclaredPlainPresentation: async () => ({ sourceRef: "daphne_observations:plain-1" }) });
    expect(withoutConsent).toMatchObject({ usedExperiment: true, assignment: { assignedOption: "STANDARD_PRESENTATION", preferredTemplateId: null, availability: false } });
    const policyOff = await assignAuthorizedPresentation(
      { ...input, occasionId: "chapter-b" },
      { ...ports, policy: { ...BEHAVIORAL_EXPERIMENT_POLICY_V1, enabled: false }, loadDeclaredPlainPresentation: async () => ({ sourceRef: "daphne_observations:plain-1" }), randomInt: () => { throw new Error("drew an arm"); } }
    );
    expect(policyOff).toMatchObject({ usedExperiment: true, assignment: { assignedOption: "STANDARD_PRESENTATION", preferredTemplateId: null } });
    expect(rows.every(row => row.assignedOption === "STANDARD_PRESENTATION")).toBe(true);
  });
  it("a newly declared plain preference wins over a replayed morning story", async () => {
    const { ports } = setup();
    const story = await assignAuthorizedPresentation(input, ports);
    expect(story.assignment?.preferredTemplateId).toBeTruthy();
    const plain = await assignAuthorizedPresentation(input, { ...ports, loadDeclaredPlainPresentation: async () => ({ sourceRef: "daphne_observations:plain-2" }) });
    expect(plain.assignment?.assignedOption).toBe("STANDARD_PRESENTATION");
    expect(plain.assignment?.preferredTemplateId).toBeNull();
    expect(plain.assignment?.decisionPointId).toBe(story.assignment?.decisionPointId);
    expect(plain.assignment).not.toEqual(story.assignment);
  });
  it("abstains and writes nothing for an operator without experimentation consent, or when history cannot be read", async () => {
    const { rows, ports, revoke } = setup();
    expect(await assignAuthorizedPresentation(input, { ...ports, loadDeclaredPlainPresentation: async () => { throw new Error("db down"); } }))
      .toMatchObject({ usedExperiment: false, skipReason: "presentation_history_unavailable" });
    revoke();
    expect(await assignAuthorizedPresentation(input, ports)).toMatchObject({ usedExperiment: false, skipReason: "fresh_operator_experimentation_consent_required", assignment: null });
    expect(rows).toHaveLength(0);
  });
});

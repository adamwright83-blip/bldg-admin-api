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
  };
  const ports: PresentationRuntimePorts = { store, randomInt: () => 1, policy: { ...BEHAVIORAL_EXPERIMENT_POLICY_V1, enabled: true },
    loadConsent: async () => ({ adaptationAllowed: consent, experimentationAllowed: consent, evidenceRefs: consent ? ["pref:1", "experiment:1"] : ["revoked:2"] }),
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
});

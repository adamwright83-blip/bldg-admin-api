import type { ActionGrammar } from "../../shared/actionGrammar";
import { behavioralSubjectFromGrammar } from "../../shared/behavioralSubject";
import { FICTION_ELIGIBILITY_CATALOG } from "../../shared/fictionEligibilityCatalog";
import { STANDARD_PRESENTATION } from "../../shared/behavioralInterventionMapping";
import { eligibleTemplates } from "../../shared/fictionTemplate";
import { resolveProductionExperimentPolicy } from "../../shared/behavioralExperimentPolicy";
import { resolveCanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import { loadDaphneMetaPreferences } from "../agents/daphne/goalsPreferences";
import { loadOperatorFictionGrammar } from "../experience/goldline/world/campaignService";
import { assignExperimentalPresentation } from "./assignPresentation";
import { listBehavioralLedgerEventsForDecisionPoint, recordBehavioralLedgerEvent, type BehavioralLedgerStore } from "../behavioralLedger/behavioralLedger";
import { loadMissionPresentations } from "../agents/daphne/missionFollowUp";
import { loadPresentationAssignmentOutcomes, presentationOutcomesAsDaphneEvidence } from "./presentationOutcomes";

export type PresentationScope = { tenantId: string; operatorUserId: string };
export type PresentationConsent = {
  adaptationAllowed: boolean;
  experimentationAllowed: boolean;
  evidenceRefs: string[];
  /** The stored experimentation choice alone, even while adaptation is off. Absent means not on. */
  experimentationChoiceStored?: boolean;
};
export async function loadPresentationConsent(scope: PresentationScope): Promise<PresentationConsent> {
  const identity = await resolveCanonicalOperatorIdentity({ tenantId: scope.tenantId,
    source: { type: "open_id", value: scope.operatorUserId }, subsystem: "daphne.presentation" });
  if (!identity.ok) return { adaptationAllowed: false, experimentationAllowed: false, evidenceRefs: [] };
  const preferences = await loadDaphneMetaPreferences({ tenantId: scope.tenantId, canonicalOperatorId: identity.identity.canonicalOperatorId });
  const enabled = (key: "adaptation_enabled" | "safe_experimentation") => preferences[key]?.status === "active" && preferences[key]?.value === true;
  const recall = preferences.memory_recall;
  const adaptationAllowed = enabled("adaptation_enabled") && recall?.status !== "revoked" && recall?.value !== false;
  return { adaptationAllowed, experimentationAllowed: adaptationAllowed && enabled("safe_experimentation"),
    experimentationChoiceStored: enabled("safe_experimentation"),
    evidenceRefs: [preferences.adaptation_enabled?.id, preferences.safe_experimentation?.id].filter((id): id is string => Boolean(id)) };
}
/** The operator's own "plain, no story" request, recorded by Daphne from their explanation of unfinished work. */
export async function loadDeclaredPlainPresentation(scope: PresentationScope): Promise<{ sourceRef: string } | null> {
  const identity = await resolveCanonicalOperatorIdentity({ tenantId: scope.tenantId,
    source: { type: "open_id", value: scope.operatorUserId }, subsystem: "daphne.presentation" });
  if (!identity.ok) return null;
  const presentations = await loadMissionPresentations({ tenantId: scope.tenantId, canonicalOperatorId: identity.identity.canonicalOperatorId });
  for (const presentation of presentations.values()) {
    if (presentation.adjustment.kind === "presentation_style" && presentation.adjustment.style === "plain")
      return { sourceRef: `daphne_observations:${presentation.sourceObservationId}` };
  }
  return null;
}
export type PresentationRuntimePorts = {
  loadConsent: typeof loadPresentationConsent;
  loadDeclaredPlainPresentation: typeof loadDeclaredPlainPresentation;
  loadGrammar: (scope: PresentationScope & { occasionId?: string }) => Promise<ActionGrammar | null>;
  store?: BehavioralLedgerStore;
  randomInt?: (n: number) => number;
  policy?: ReturnType<typeof resolveProductionExperimentPolicy>;
};
const defaults: PresentationRuntimePorts = {
  loadConsent: loadPresentationConsent,
  loadDeclaredPlainPresentation,
  loadGrammar: scope => loadOperatorFictionGrammar({ tenantId: scope.tenantId, operatorId: scope.operatorUserId, occasionId: scope.occasionId }),
};
/**
 * The Goldline presentation decision point: chooses `preferredTemplateId` for
 * one mission occasion. Daphne gates it (safe_experimentation consent, a
 * declared plain preference, fatigue from joined outcomes) and makes the draw;
 * every decision is recorded before it is returned. A declared plain preference
 * is the baseline even when experimentation is off. Without that preference,
 * and without experimentation consent, nothing is assigned or recorded.
 * Client grammar, template, outcome and consent claims never supply authority.
 */
export async function assignAuthorizedPresentation(input: PresentationScope & { correlationId: string; occasionId: string; emergency?: boolean; now?: Date }, ports: PresentationRuntimePorts = defaults) {
  const consent = await ports.loadConsent(input);
  const unavailable = (skipReason: string) => ({ usedExperiment: false as const, skipReason, assignment: null, consent });
  let declaredPlain: { sourceRef: string } | null = null;
  let plainUnreadable = false;
  try {
    declaredPlain = await ports.loadDeclaredPlainPresentation(input);
  } catch {
    plainUnreadable = true;
  }
  // "Keep it plain" is loaded before the experimentation gate so it cannot fall through to fiction.
  if (!declaredPlain && !consent.experimentationAllowed) return unavailable("fresh_operator_experimentation_consent_required");
  const grammar = await ports.loadGrammar(input);
  if (!grammar || behavioralSubjectFromGrammar(grammar) !== input.correlationId) return unavailable("canonical_mission_grammar_unavailable");
  const result = await assignExperimentalPresentation({ ...input, grammar, registry: FICTION_ELIGIBILITY_CATALOG,
    policy: ports.policy ?? resolveProductionExperimentPolicy(), store: ports.store, randomInt: ports.randomInt,
    declaredPlainPresentation: declaredPlain,
    daphne: async () => {
      if (plainUnreadable) return null;
      const outcomes = await loadPresentationAssignmentOutcomes(
        { tenantId: input.tenantId, operatorUserId: input.operatorUserId },
        ports.store
      ).catch(() => null);
      if (!outcomes) return null;
      return {
        preferences: { adaptationEnabled: consent.adaptationAllowed, safeExperimentation: consent.experimentationAllowed,
          consentRevoked: !consent.adaptationAllowed },
        evidence: presentationOutcomesAsDaphneEvidence(outcomes),
        declaredPlainPresentation: declaredPlain,
      };
    } });
  return { ...result, consent };
}
/** UI acknowledgment proves a reported viewable surface; it never proves attention or business completion. */
export async function acknowledgePresentationViewable(input: PresentationScope & { correlationId: string; occasionId: string; decisionPointId: string; templateId: string }, ports: PresentationRuntimePorts = defaults) {
  const consent = await ports.loadConsent(input);
  if (!consent.experimentationAllowed) throw new Error("Presentation experimentation consent revoked or absent");
  const grammar = await ports.loadGrammar(input);
  if (!grammar || behavioralSubjectFromGrammar(grammar) !== input.correlationId) throw new Error("Canonical presentation work unavailable");
  const rows = await listBehavioralLedgerEventsForDecisionPoint(input.tenantId, input.decisionPointId, ports.store);
  const assignment = rows.find(row => row.operatorUserId === input.operatorUserId && row.correlationId === input.correlationId
    && row.eventType === "ASSIGNED" && row.assignedOption === input.templateId);
  const plainBaseline = input.templateId === STANDARD_PRESENTATION;
  if (!assignment || (!plainBaseline && !eligibleTemplates(FICTION_ELIGIBILITY_CATALOG, grammar).some(t => t.id === input.templateId)))
    throw new Error("Viewable report lacks a durable approved assignment");
  const row = await recordBehavioralLedgerEvent({ ...input, sourceSystem: "campaign_run", sourceEntityType: "presentation_viewable",
    sourceEntityId: input.decisionPointId, eventType: "VIEWABLE", occurredAt: new Date(), verificationClass: "CLAIMED",
    provenance: "authenticated_client_render_acknowledgment", evidenceSource: `assignment:${assignment.id}`,
    idempotencyKey: `presentation-viewable:${assignment.id}`, decisionPoint: {
      decisionPointId: input.decisionPointId, availability: assignment.availability !== false, eligibleOptions: assignment.eligibleOptionsJson as string[],
      assignedOption: assignment.assignedOption!, assignmentProbability: assignment.assignmentProbability == null ? null : Number(assignment.assignmentProbability),
      interventionPolicyVersion: assignment.interventionPolicyVersion!, interventionDefinitionVersion: assignment.interventionDefinitionVersion,
      proximalOutcomeWindowMinutes: assignment.proximalOutcomeWindowMinutes!,
    } }, ports.store);
  if (!row) throw new Error("Presentation acknowledgment did not persist");
  return { recorded: true as const, eventId: row.id, verificationClass: "CLAIMED" as const };
}

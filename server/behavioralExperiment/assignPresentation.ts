import { randomInt } from "node:crypto";
import { eligibleTemplates } from "../../shared/fictionTemplate";
import type { ActionGrammar } from "../../shared/actionGrammar";
import type { FictionTemplate } from "../../shared/fictionTemplate";
import {
  drawEqualProbabilityArm,
  freezeExperimentalOptionSet,
  isValidAssignmentProbability,
  preferredTemplateIdFromAssignedOption,
  presentationDecisionPointId,
  type ExperimentalAssignmentRecord,
} from "../../shared/behavioralExperimentAssignment";
import type { BehavioralExperimentPolicy } from "../../shared/behavioralExperimentPolicy";
import {
  recordBehavioralLedgerEvent,
  listBehavioralLedgerEventsForDecisionPoint,
  type BehavioralLedgerStore,
} from "../behavioralLedger/behavioralLedger";
import type { BehavioralLedgerEvent } from "../../drizzle/schema";
import type { DecisionPointFields, LedgerSourceSystem } from "../../shared/behavioralLedger";
import { STANDARD_PRESENTATION } from "../../shared/behavioralInterventionMapping";
import {
  assignDaphneMrtMissionFraming,
  type DaphneMissionPresentationEvidence,
  type DaphneMissionTrigger,
} from "../agents/daphne/missionFramingExperiment";

function sourceSystemForCorrelation(correlationId: string): LedgerSourceSystem {
  if (correlationId.startsWith("ops_task:")) return "ops_task";
  if (correlationId.startsWith("campaign:")) return "campaign_run";
  return "campaign_run";
}

function rowToAssignment(row: BehavioralLedgerEvent): ExperimentalAssignmentRecord | null {
  if (row.eventType !== "ASSIGNED" || !row.decisionPointId || !row.assignedOption) return null;
  const eligible =
    (row.eligibleOptionsJson as string[] | null) ?? [];
  const common = {
    decisionPointId: row.decisionPointId,
    correlationId: row.correlationId,
    eligibleOptions: eligible,
    assignedOption: row.assignedOption,
    interventionPolicyVersion: row.interventionPolicyVersion ?? 1,
    interventionDefinitionVersion: row.interventionDefinitionVersion ?? 1,
    proximalOutcomeWindowMinutes: row.proximalOutcomeWindowMinutes ?? 0,
    preferredTemplateId: preferredTemplateIdFromAssignedOption(row.assignedOption),
    persisted: true as const,
  };
  if (row.availability === false) {
    // Unavailable for randomization: only the baseline can have been assigned.
    if (row.assignedOption !== STANDARD_PRESENTATION || row.assignmentProbability != null) return null;
    return { ...common, availability: false, assignmentMechanism: "fatigue_throttle", assignmentProbability: null };
  }
  if (row.availability !== true || row.assignmentProbability == null) return null;
  const probability = Number(row.assignmentProbability);
  if (!isValidAssignmentProbability(probability)) return null;
  return { ...common, availability: true, assignmentMechanism: "randomized_assignment", assignmentProbability: probability };
}

/** Coarse trigger for Daphne's immersion vocabulary. Not used to pick arms from a frozen set. */
function daphneTriggerForGrammar(grammar: ActionGrammar): DaphneMissionTrigger {
  if (grammar.channel === "phone") return "outbound_call";
  if (grammar.requiresTravel || grammar.channel === "in_person") return "field_arrival";
  return "non_field";
}

export type AssignExperimentalPresentationInput = {
  tenantId: string;
  operatorUserId: string;
  correlationId: string;
  occasionId: string;
  grammar: ActionGrammar;
  registry: readonly FictionTemplate[];
  policy: BehavioralExperimentPolicy;
  emergency?: boolean;
  /** Ignored if present — client cannot choose the arm. */
  clientAssignedOption?: string | null;
  clientAssignmentProbability?: number | null;
  now?: Date;
  store?: BehavioralLedgerStore;
  randomInt?: (n: number) => number;
  /**
   * Daphne's consent, declared-preference and fatigue gate. The production
   * runtime always supplies it; Daphne then makes the draw over the frozen set.
   */
  /** Called only when a fresh decision is needed; null means the gate cannot be evaluated. */
  daphne?: () => Promise<DaphnePresentationGate | null>;
};

export type DaphnePresentationGate = {
  preferences: { adaptationEnabled: boolean; safeExperimentation: boolean; consentRevoked: boolean };
  evidence: readonly DaphneMissionPresentationEvidence[];
  declaredPlainPresentation: { sourceRef: string } | null;
};

export type AssignExperimentalPresentationResult =
  | { usedExperiment: true; assignment: ExperimentalAssignmentRecord }
  | { usedExperiment: false; skipReason: string; assignment: null };

export async function assignExperimentalPresentation(
  input: AssignExperimentalPresentationInput
): Promise<AssignExperimentalPresentationResult> {
  const tenantId = input.tenantId.trim();
  const operatorUserId = input.operatorUserId.trim();
  const correlationId = input.correlationId.trim();
  const occasionId = input.occasionId.trim();
  if (!tenantId || !operatorUserId || !correlationId || !occasionId) {
    return { usedExperiment: false, skipReason: "missing_identity", assignment: null };
  }
  void input.clientAssignedOption;
  void input.clientAssignmentProbability;

  const decisionPointId = presentationDecisionPointId({ correlationId, occasionId });
  if (!input.policy.enabled) return { usedExperiment: false, skipReason: "policy_disabled", assignment: null };
  const currentlyEligible = new Set(eligibleTemplates(input.registry, input.grammar).map(t => t.id));
  const existing = await listBehavioralLedgerEventsForDecisionPoint(
    tenantId,
    decisionPointId,
    input.store
  );
  const existingAssignment = existing
    .filter(row => row.operatorUserId === operatorUserId)
    .map(rowToAssignment)
    .find(Boolean);
  if (existingAssignment && (existingAssignment.preferredTemplateId === null || currentlyEligible.has(existingAssignment.preferredTemplateId))) {
    return { usedExperiment: true, assignment: existingAssignment };
  }

  const frozen = freezeExperimentalOptionSet({
    grammar: input.grammar,
    registry: input.registry,
    policy: input.policy,
    emergency: input.emergency,
  });
  if (!frozen.distribution) {
    return { usedExperiment: false, skipReason: frozen.skipReason ?? "unavailable", assignment: null };
  }

  // The ledger column holds whole seconds and MySQL rounds fractions up, which
  // would place the assignment after an outcome recorded in the same second.
  const now = new Date(Math.floor((input.now ?? new Date()).getTime() / 1000) * 1000);
  const policyFields = {
    interventionPolicyVersion: input.policy.numericVersion,
    interventionDefinitionVersion: input.policy.interventionDefinitionVersion,
    proximalOutcomeWindowMinutes: input.policy.proximalOutcomeWindowMinutes,
  };
  let decisionPoint: DecisionPointFields;
  let provenance = `mrt_randomized_assignment:${input.policy.id}:${input.policy.version}`;
  let evidenceSource = `mrt_decision_point:${decisionPointId}`;
  if (input.daphne) {
    const gate = await input.daphne();
    // Fatigue cannot be assessed without history, so no history means no experiment.
    if (!gate) return { usedExperiment: false, skipReason: "presentation_history_unavailable", assignment: null };
    const framed = assignDaphneMrtMissionFraming({
      tenantId,
      operatorUserId,
      missionId: correlationId,
      correlationId,
      occasionId,
      missionType: input.grammar.kind,
      trigger: daphneTriggerForGrammar(input.grammar),
      activeVariantId: STANDARD_PRESENTATION,
      preferences: gate.preferences,
      variants: [],
      evidence: gate.evidence,
      declaredPlainPresentation: gate.declaredPlainPresentation,
      frozenOptions: frozen.distribution.options,
      now,
      randomInt: input.randomInt ?? (n => randomInt(n)),
    });
    if (framed.status === "abstain") {
      return { usedExperiment: false, skipReason: `daphne_${framed.reason}`, assignment: null };
    }
    if (framed.decisionPointId !== decisionPointId) {
      return { usedExperiment: false, skipReason: "decision_point_mismatch", assignment: null };
    }
    if (framed.status === "throttled_to_baseline") {
      // Not randomized: the operator is unavailable at this decision point and
      // gets the baseline with certainty. The row keeps the considered set.
      decisionPoint = {
        decisionPointId,
        availability: false,
        eligibleOptions: [...frozen.distribution.options],
        assignedOption: STANDARD_PRESENTATION,
        assignmentProbability: null,
        ...policyFields,
      };
      provenance = `daphne_fatigue_throttle:${framed.fatigueReason}:${input.policy.id}:${input.policy.version}`;
      evidenceSource = `daphne_evidence:${framed.evidenceRefs.join(",")}`;
    } else {
      decisionPoint = {
        decisionPointId,
        availability: true,
        eligibleOptions: [...framed.eligibleOptions],
        assignedOption: framed.assignedOption,
        assignmentProbability: framed.assignmentProbability,
        ...policyFields,
      };
      provenance = `daphne_mrt_randomized_assignment:${input.policy.id}:${input.policy.version}`;
    }
  } else {
    const draw = drawEqualProbabilityArm({
      options: frozen.distribution.options,
      randomInt: input.randomInt ?? (n => randomInt(n)),
    });
    if (!isValidAssignmentProbability(draw.assignmentProbability)) {
      return { usedExperiment: false, skipReason: "unavailable", assignment: null };
    }
    decisionPoint = {
      decisionPointId,
      availability: true,
      eligibleOptions: [...frozen.distribution.options],
      assignedOption: draw.assignedOption,
      assignmentProbability: draw.assignmentProbability,
      ...policyFields,
    };
  }

  const row = await recordBehavioralLedgerEvent(
    {
      tenantId,
      operatorUserId,
      correlationId,
      sourceSystem: sourceSystemForCorrelation(correlationId),
      sourceEntityType: "mrt_decision_point",
      sourceEntityId: decisionPointId,
      eventType: "ASSIGNED",
      occurredAt: now,
      verificationClass: null,
      provenance: provenance.slice(0, 191),
      evidenceSource: evidenceSource.slice(0, 191),
      idempotencyKey: `mrt_assignment:${decisionPointId}`.slice(0, 191),
      decisionPoint,
    },
    input.store
  );
  if (!row) return { usedExperiment: false, skipReason: "unavailable", assignment: null };
  const assignment = rowToAssignment(row);
  if (!assignment) return { usedExperiment: false, skipReason: "unavailable", assignment: null };
  return { usedExperiment: true, assignment };
}

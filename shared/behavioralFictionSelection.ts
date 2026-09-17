import type { ActionGrammar } from "./actionGrammar";
import type { LedgerEventType } from "./behavioralLedger";
import {
  assembleBehavioralEvidence,
  type BehavioralEvidence,
  type BehavioralLedgerLikeEvent,
  type OperatorDeclaredBarrier,
} from "./behavioralEvidence";
import { behavioralSubjectFromGrammar } from "./behavioralSubject";
import {
  DIAGNOSIS_FORBIDDEN_PATTERNS,
  ENABLEMENT_TIME_FRICTION,
  INTERVENTION_DEFINITION_VERSION,
  INTERVENTION_POLICY_VERSION,
  STANDARD_PRESENTATION,
  type CombComponent,
  type EpistemicClass,
  type InterventionDefinitionRecord,
  type TdfDomain,
} from "./behavioralInterventionMapping";
import { eligibleTemplates, type FictionTemplate } from "./fictionTemplate";

export type AssignmentMechanism = "deterministic_policy" | "randomized_assignment";

export type BarrierHypothesis = {
  present: boolean;
  comb: CombComponent | null;
  tdfDomain: TdfDomain | null;
  label: string;
  evidenceStrength: "none" | "possible" | "declared";
  source: EpistemicClass | "none";
  supportingObservations: string[];
  uncertainty: string;
};

export type FictionSelectionDecision = {
  businessActionId: string | null;
  grammarKind: ActionGrammar["kind"];
  correlationId: string;
  preferredTemplateId: string | null;
  assignedOption: string;
  eligibleOptions: string[];
  eligibleFictionTemplateIds: string[];
  assignmentMechanism: AssignmentMechanism;
  /** Populated only when assignment was actually randomized. Always null for deterministic_policy. */
  assignmentProbability: number | null;
  interventionPolicyVersion: typeof INTERVENTION_POLICY_VERSION;
  interventionDefinitionVersion: typeof INTERVENTION_DEFINITION_VERSION;
  intervention: InterventionDefinitionRecord | null;
  barrierHypothesis: BarrierHypothesis;
  evidence: BehavioralEvidence;
  selectionReason: string;
  claireSafeExplanation: string;
};

function hypothesisFromEvidence(evidence: BehavioralEvidence): BarrierHypothesis {
  const timeDeclared = evidence.declaredBarriers.some(item => item.key === "time");
  if (timeDeclared) {
    const statement = evidence.declaredBarriers.find(item => item.key === "time")!.statement;
    return {
      present: true,
      comb: "opportunity",
      tdfDomain: "environmental_context_and_resources",
      label: "declared time constraint",
      evidenceStrength: "declared",
      source: "operator-declared",
      supportingObservations: [statement, `observed deferred count=${evidence.counts.deferred}`],
      uncertainty:
        "An operator-declared time constraint is a preference/barrier report, not a diagnosis of motivation or avoidance.",
    };
  }
  if (evidence.counts.deferred >= 2) {
    return {
      present: true,
      comb: "opportunity",
      tdfDomain: "environmental_context_and_resources",
      label: "possible scheduling/opportunity friction",
      evidenceStrength: "possible",
      source: "behavior-observed",
      supportingObservations: [
        `delivered=${evidence.counts.delivered}`,
        `deferred=${evidence.counts.deferred} (explicit operator acts only)`,
        `started=${evidence.counts.started}`,
        `completed=${evidence.counts.completed}`,
      ],
      uncertainty:
        "Repeated explicit deferral can indicate scheduling or opportunity friction. It does not classify time unless the operator declared time, and it does not establish a motivational trait.",
    };
  }
  return {
    present: false,
    comb: null,
    tdfDomain: null,
    label: "insufficient evidence",
    evidenceStrength: "none",
    source: "none",
    supportingObservations: [
      `delivered=${evidence.counts.delivered}`,
      `deferred=${evidence.counts.deferred}`,
    ],
    uncertainty: "No barrier was manufactured. Conservative standard presentation applies.",
  };
}

function fnvIndex(seed: string, modulo: number): number {
  if (modulo <= 0) return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % modulo;
}

function explain(decision: {
  hypothesis: BarrierHypothesis;
  assignedOption: string;
  evidence: BehavioralEvidence;
}): string {
  const { deferred, delivered } = decision.evidence.counts;
  if (decision.hypothesis.source === "operator-declared") {
    return `You said time is the constraint, so I'm keeping the shorter plain version today.`;
  }
  if (decision.hypothesis.present && decision.assignedOption !== STANDARD_PRESENTATION) {
    return `This has come up ${delivered} times and you deferred it ${deferred} times, so I'm giving you a different eligible presentation today.`;
  }
  if (decision.hypothesis.present) {
    return `This has come up ${delivered} times and you deferred it ${deferred} times, so I'm giving you a shorter version today.`;
  }
  return "No extra behavioral history for this task, so the usual safe presentation stands.";
}

/**
 * Choose a presentation for an already-valid ActionGrammar.
 * Never mutates the grammar or ledger events. Eligibility outranks preference.
 * History is assembled by correlationId (ops_task:<taskId>), not sourceEntityId.
 */
export function selectPreferredFictionPresentation(input: {
  tenantId: string;
  operatorUserId: string;
  grammar: ActionGrammar;
  registry: readonly FictionTemplate[];
  events: readonly BehavioralLedgerLikeEvent[];
  declaredBarriers?: readonly OperatorDeclaredBarrier[];
  decisionPointId?: string;
  correlationId?: string;
}): FictionSelectionDecision {
  const correlationId = input.correlationId ?? behavioralSubjectFromGrammar(input.grammar);
  const evidence = assembleBehavioralEvidence({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    correlationId,
    events: input.events,
    declaredBarriers: input.declaredBarriers,
  });
  const grammar = input.grammar;
  const eligibleFiction = eligibleTemplates(input.registry, grammar);
  const eligibleFictionIds = eligibleFiction.map(item => item.id);
  const hypothesis = hypothesisFromEvidence(evidence);

  const eligibleOptions = [STANDARD_PRESENTATION, ...eligibleFictionIds];

  let assignedOption: string = STANDARD_PRESENTATION;
  let preferredTemplateId: string | null = null;
  const assignmentMechanism: AssignmentMechanism = "deterministic_policy";
  const assignmentProbability: number | null = null;
  let selectionReason =
    "Insufficient evidence; STANDARD_PRESENTATION (existing hash fallback when preferredTemplateId is null).";
  let intervention: InterventionDefinitionRecord | null = null;

  if (hypothesis.present && hypothesis.source === "operator-declared") {
    intervention = ENABLEMENT_TIME_FRICTION;
    assignedOption = STANDARD_PRESENTATION;
    preferredTemplateId = null;
    selectionReason =
      "Operator-declared time barrier outranks inferred history; plain/standard presentation.";
  } else if (hypothesis.present && eligibleFictionIds.length > 0) {
    intervention = ENABLEMENT_TIME_FRICTION;
    const seed = `${input.decisionPointId ?? correlationId}:${evidence.counts.deferred}:${evidence.counts.delivered}`;
    const index = fnvIndex(seed, eligibleFictionIds.length);
    assignedOption = eligibleFictionIds[index]!;
    preferredTemplateId = assignedOption;
    selectionReason =
      "Behavior-observed explicit deferrals; deterministic_policy pick among already-eligible templates. Not randomized assignment and not a causal ranking.";
  }

  const decision: FictionSelectionDecision = {
    businessActionId: grammar.businessActionId,
    grammarKind: grammar.kind,
    correlationId,
    preferredTemplateId,
    assignedOption,
    eligibleOptions,
    eligibleFictionTemplateIds: eligibleFictionIds,
    assignmentMechanism,
    assignmentProbability,
    interventionPolicyVersion: INTERVENTION_POLICY_VERSION,
    interventionDefinitionVersion: INTERVENTION_DEFINITION_VERSION,
    intervention,
    barrierHypothesis: hypothesis,
    evidence,
    selectionReason,
    claireSafeExplanation: "",
  };
  decision.claireSafeExplanation = explain({
    hypothesis,
    assignedOption,
    evidence,
  });
  return decision;
}

export function selectionTextIsEpistemicallySafe(text: string): boolean {
  return !DIAGNOSIS_FORBIDDEN_PATTERNS.some(pattern => pattern.test(text));
}

/** Value the existing Fiction Director should receive as `preferredTemplateId`. */
export function preferredTemplateIdForDirector(input: {
  tenantId?: string | null;
  operatorUserId?: string | null;
  grammar: ActionGrammar;
  registry: readonly FictionTemplate[];
  events?: readonly BehavioralLedgerLikeEvent[];
  declaredBarriers?: readonly OperatorDeclaredBarrier[];
  campaignPreferredTemplateId?: string | null;
  decisionPointId?: string;
}): { preferredTemplateId: string | null; fromBehavioralSelector: boolean } {
  const tenantId = input.tenantId?.trim() || null;
  const operatorUserId = input.operatorUserId?.trim() || null;
  if (tenantId && operatorUserId) {
    const decision = selectPreferredFictionPresentation({
      tenantId,
      operatorUserId,
      grammar: input.grammar,
      registry: input.registry,
      events: input.events ?? [],
      declaredBarriers: input.declaredBarriers,
      decisionPointId: input.decisionPointId,
    });
    if (decision.preferredTemplateId) {
      return { preferredTemplateId: decision.preferredTemplateId, fromBehavioralSelector: true };
    }
  }
  return {
    preferredTemplateId: input.campaignPreferredTemplateId ?? null,
    fromBehavioralSelector: false,
  };
}

export type { LedgerEventType };

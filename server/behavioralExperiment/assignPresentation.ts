import { randomInt } from "node:crypto";
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
import type { LedgerSourceSystem } from "../../shared/behavioralLedger";

function sourceSystemForCorrelation(correlationId: string): LedgerSourceSystem {
  if (correlationId.startsWith("ops_task:")) return "ops_task";
  if (correlationId.startsWith("campaign:")) return "campaign_run";
  return "campaign_run";
}

function rowToAssignment(row: BehavioralLedgerEvent): ExperimentalAssignmentRecord | null {
  if (!row.decisionPointId || !row.assignedOption || row.availability !== true) return null;
  if (row.assignmentProbability == null) return null;
  const probability = Number(row.assignmentProbability);
  if (!isValidAssignmentProbability(probability)) return null;
  const eligible =
    (row.eligibleOptionsJson as string[] | null) ?? [];
  return {
    decisionPointId: row.decisionPointId,
    correlationId: row.correlationId,
    availability: true,
    eligibleOptions: eligible,
    assignedOption: row.assignedOption,
    assignmentMechanism: "randomized_assignment",
    assignmentProbability: probability,
    interventionPolicyVersion: row.interventionPolicyVersion ?? 1,
    interventionDefinitionVersion: row.interventionDefinitionVersion ?? 1,
    proximalOutcomeWindowMinutes: row.proximalOutcomeWindowMinutes ?? 0,
    preferredTemplateId: preferredTemplateIdFromAssignedOption(row.assignedOption),
    persisted: true,
  };
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
  const existing = await listBehavioralLedgerEventsForDecisionPoint(
    tenantId,
    decisionPointId,
    input.store
  );
  const existingAssignment = existing
    .filter(row => row.operatorUserId === operatorUserId)
    .map(rowToAssignment)
    .find(Boolean);
  if (existingAssignment) {
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

  const draw = drawEqualProbabilityArm({
    options: frozen.distribution.options,
    randomInt: input.randomInt ?? (n => randomInt(n)),
  });
  if (!isValidAssignmentProbability(draw.assignmentProbability)) {
    return { usedExperiment: false, skipReason: "unavailable", assignment: null };
  }

  const now = input.now ?? new Date();
  const row = await recordBehavioralLedgerEvent(
    {
      tenantId,
      operatorUserId,
      correlationId,
      sourceSystem: sourceSystemForCorrelation(correlationId),
      sourceEntityType: "mrt_decision_point",
      sourceEntityId: decisionPointId,
      eventType: "DELIVERED",
      occurredAt: now,
      verificationClass: null,
      provenance: `mrt_randomized_assignment:${input.policy.id}:${input.policy.version}`,
      evidenceSource: `mrt_decision_point:${decisionPointId}`,
      idempotencyKey: `mrt_assignment:${decisionPointId}`.slice(0, 191),
      decisionPoint: {
        decisionPointId,
        availability: true,
        eligibleOptions: [...frozen.distribution.options],
        assignedOption: draw.assignedOption,
        assignmentProbability: draw.assignmentProbability,
        interventionPolicyVersion: input.policy.numericVersion,
        interventionDefinitionVersion: input.policy.interventionDefinitionVersion,
        proximalOutcomeWindowMinutes: input.policy.proximalOutcomeWindowMinutes,
      },
    },
    input.store
  );
  if (!row) return { usedExperiment: false, skipReason: "unavailable", assignment: null };
  const assignment = rowToAssignment(row);
  if (!assignment) return { usedExperiment: false, skipReason: "unavailable", assignment: null };
  return { usedExperiment: true, assignment };
}

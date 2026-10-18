/**
 * Stage 1 authority rule: nothing reaches the Day Line without the operator.
 *
 * Every Day Director commitment write must carry one admission proof:
 *  - `strategic_approval`: the operator's exact approval of a proposal item,
 *    verified against the stored approval response;
 *  - `operator_instruction`: an authenticated, direct operator instruction
 *    (Day Line UI, Claire turn, Tower Wars UI) carrying the operator's user id;
 *  - `operator_recurrence_rule`: an active recurrence rule the operator
 *    confirmed, verified against storage, projected onto a matching date.
 *
 * Missing, malformed or unknown proof fails closed. A machine policy receipt
 * (for example an INTERNAL_REVERSIBLE goal-cycle grant) is not admission.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  dayDirectorRecurrenceRules,
  strategicProposalResponses,
} from "../../../drizzle/schema";
import type { DayDirectorProposal } from "../../../shared/dayDirector";
import { getDb } from "../../db";

export const DAY_LINE_INSTRUCTION_SURFACES = [
  "day_line_ui",
  "claire_turn",
  "tower_wars_ui",
] as const;
export type DayLineInstructionSurface = (typeof DAY_LINE_INSTRUCTION_SURFACES)[number];

export type DayLineStrategicApprovalAdmission = {
  kind: "strategic_approval";
  proposalId: string;
  revision: string;
  itemId: string;
  responseId: string;
  canonicalOperatorId: string;
  approvedByUserId: string;
};

export type DayLineOperatorInstructionAdmission = {
  kind: "operator_instruction";
  operatorUserId: string;
  surface: DayLineInstructionSurface;
  /** The instruction this write came from: a conversation turn, request id or procedure. */
  sourceRef: string;
};

export type DayLineRecurrenceRuleAdmission = {
  kind: "operator_recurrence_rule";
  ruleId: string;
};

export type DayLineAdmission =
  | DayLineStrategicApprovalAdmission
  | DayLineOperatorInstructionAdmission
  | DayLineRecurrenceRuleAdmission;

/** The parts of a commitment write that admission checks. */
export type AdmittedProposal = Pick<DayDirectorProposal, "promptKey" | "strategicApproval" | "command">;

export class DayLineAdmissionRefusedError extends Error {
  readonly code = "DAY_LINE_ADMISSION_REFUSED" as const;
  constructor(reason: string) {
    super(`Day Line write refused: ${reason}. Nothing was added.`);
    this.name = "DayLineAdmissionRefusedError";
  }
}

const RESERVED_OPERATOR_IDS = new Set(["", "unknown", "system", "anonymous", "machine", "worker"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Authenticated direct operator instruction. Only operator-facing entry points construct one. */
export function operatorInstructionAdmission(input: {
  operatorUserId: string;
  surface: DayLineInstructionSurface;
  sourceRef: string;
}): DayLineOperatorInstructionAdmission {
  return {
    kind: "operator_instruction",
    operatorUserId: input.operatorUserId.trim(),
    surface: input.surface,
    sourceRef: input.sourceRef.trim().slice(0, 191),
  };
}

/** The exact lineage `respondToStrategicProposal` stamps on the proposal it approves. */
export function strategicApprovalAdmission(
  approval: NonNullable<DayDirectorProposal["strategicApproval"]>
): DayLineStrategicApprovalAdmission {
  return { kind: "strategic_approval", ...approval };
}

export function recurrenceRuleAdmission(ruleId: string): DayLineRecurrenceRuleAdmission {
  return { kind: "operator_recurrence_rule", ruleId: ruleId.trim() };
}

/** The audit record stored with the commitment. */
export function admissionRecord(admission: DayLineAdmission): Record<string, string> {
  switch (admission.kind) {
    case "strategic_approval":
      return {
        kind: admission.kind,
        proposalId: admission.proposalId,
        revision: admission.revision,
        itemId: admission.itemId,
        responseId: admission.responseId,
        approvedByUserId: admission.approvedByUserId,
      };
    case "operator_instruction":
      return {
        kind: admission.kind,
        operatorUserId: admission.operatorUserId,
        surface: admission.surface,
        sourceRef: admission.sourceRef,
      };
    case "operator_recurrence_rule":
      return { kind: admission.kind, ruleId: admission.ruleId };
  }
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function assertStoredStrategicApproval(input: {
  tenantId: string;
  proof: DayLineStrategicApprovalAdmission;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new DayLineAdmissionRefusedError("the approval record cannot be read");
  const [row] = await db
    .select()
    .from(strategicProposalResponses)
    .where(
      and(
        eq(strategicProposalResponses.id, input.proof.responseId),
        eq(strategicProposalResponses.tenantId, input.tenantId),
        eq(strategicProposalResponses.canonicalOperatorId, input.proof.canonicalOperatorId),
        eq(strategicProposalResponses.proposalId, input.proof.proposalId)
      )
    )
    .limit(1);
  const response = parseJson(row?.responseJson);
  const itemIds = Array.isArray(response?.itemIds) ? response.itemIds.map(String) : [];
  if (
    !response ||
    response.action !== "approve" ||
    response.revision !== input.proof.revision ||
    response.proposalId !== input.proof.proposalId ||
    response.operatorUserId !== input.proof.approvedByUserId ||
    !itemIds.includes(input.proof.itemId)
  ) {
    throw new DayLineAdmissionRefusedError("no stored operator approval matches this item");
  }
}

async function assertActiveRecurrenceRule(input: {
  tenantId: string;
  actorIds: readonly string[];
  businessDate: string;
  proposal: AdmittedProposal;
  proof: DayLineRecurrenceRuleAdmission;
}): Promise<void> {
  if (input.proposal.command?.recurrenceRuleId !== input.proof.ruleId) {
    throw new DayLineAdmissionRefusedError("the projected item does not name its recurrence rule");
  }
  if (input.proposal.promptKey !== `recurrence:${input.proof.ruleId}:${input.businessDate}`) {
    throw new DayLineAdmissionRefusedError("the projected item is not this rule's occurrence for that date");
  }
  const db = await getDb();
  if (!db) throw new DayLineAdmissionRefusedError("the recurrence rule cannot be read");
  const [rule] = await db
    .select()
    .from(dayDirectorRecurrenceRules)
    .where(
      and(
        eq(dayDirectorRecurrenceRules.tenantId, input.tenantId),
        inArray(dayDirectorRecurrenceRules.actorId, [...input.actorIds]),
        eq(dayDirectorRecurrenceRules.id, input.proof.ruleId)
      )
    )
    .limit(1);
  if (!rule || rule.status !== "active") {
    throw new DayLineAdmissionRefusedError("the recurrence rule is not active for this operator");
  }
}

/**
 * Refuses the write unless `admission` is a recognised proof that matches the proposal.
 * Called by every Day Director commitment writer before any row is read or written.
 */
export async function assertDayLineAdmission(input: {
  tenantId: string;
  actorIds: readonly string[];
  businessDate: string;
  proposal: AdmittedProposal;
  admission: unknown;
}): Promise<DayLineAdmission> {
  const raw = input.admission;
  if (!raw || typeof raw !== "object") {
    throw new DayLineAdmissionRefusedError("no operator approval or instruction was provided");
  }
  const proof = raw as Record<string, unknown>;
  const lineage = input.proposal.strategicApproval;

  if (proof.kind === "strategic_approval") {
    const claimed: DayLineStrategicApprovalAdmission = {
      kind: "strategic_approval",
      proposalId: text(proof.proposalId),
      revision: text(proof.revision),
      itemId: text(proof.itemId),
      responseId: text(proof.responseId),
      canonicalOperatorId: text(proof.canonicalOperatorId),
      approvedByUserId: text(proof.approvedByUserId),
    };
    if (Object.values(claimed).some(value => !value)) {
      throw new DayLineAdmissionRefusedError("the strategic approval proof is incomplete");
    }
    if (
      !lineage ||
      lineage.proposalId !== claimed.proposalId ||
      lineage.revision !== claimed.revision ||
      lineage.itemId !== claimed.itemId ||
      lineage.responseId !== claimed.responseId ||
      lineage.canonicalOperatorId !== claimed.canonicalOperatorId ||
      lineage.approvedByUserId !== claimed.approvedByUserId
    ) {
      throw new DayLineAdmissionRefusedError("the approval proof does not match the item's approval lineage");
    }
    await assertStoredStrategicApproval({ tenantId: input.tenantId, proof: claimed });
    return claimed;
  }

  // Approval lineage on the proposal is only ever admitted by that exact approval.
  if (lineage) {
    throw new DayLineAdmissionRefusedError("an item that claims strategic approval needs that approval as its proof");
  }

  if (proof.kind === "operator_instruction") {
    const operatorUserId = text(proof.operatorUserId);
    const sourceRef = text(proof.sourceRef);
    const surface = proof.surface;
    if (RESERVED_OPERATOR_IDS.has(operatorUserId.toLowerCase())) {
      throw new DayLineAdmissionRefusedError("the operator instruction has no operator user id");
    }
    if (!DAY_LINE_INSTRUCTION_SURFACES.includes(surface as DayLineInstructionSurface)) {
      throw new DayLineAdmissionRefusedError("the operator instruction came from an unrecognised surface");
    }
    if (!sourceRef) {
      throw new DayLineAdmissionRefusedError("the operator instruction does not name its source");
    }
    return operatorInstructionAdmission({
      operatorUserId,
      surface: surface as DayLineInstructionSurface,
      sourceRef,
    });
  }

  if (proof.kind === "operator_recurrence_rule") {
    const claimed = recurrenceRuleAdmission(text(proof.ruleId));
    if (!claimed.ruleId) throw new DayLineAdmissionRefusedError("the recurrence proof names no rule");
    await assertActiveRecurrenceRule({
      tenantId: input.tenantId,
      actorIds: input.actorIds,
      businessDate: input.businessDate,
      proposal: input.proposal,
      proof: claimed,
    });
    return claimed;
  }

  throw new DayLineAdmissionRefusedError("the admission proof is not a recognised operator approval or instruction");
}

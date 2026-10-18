import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import {
  dayDirectorRecurrenceRules,
  strategicProposalResponses,
} from "../../../drizzle/schema";
import type { DayDirectorProposal } from "../../../shared/dayDirector";
import { getDb } from "../../db";

/**
 * Stage 1 authority rule at the Day Director write boundary.
 *
 * Claire may prepare work on her own. A Day Line commitment is written only on
 * the operator's authority, and every writer in dayDirectorService names which:
 *
 * - `strategic_approval`: the operator approved this exact proposal item. The
 *   approval must be the one recorded in strategic_proposal_responses.
 * - `operator_instruction`: the operator asked for this write on an
 *   authenticated surface, in this request. The instruction must come from the
 *   operator whose Day Line is written.
 * - `operator_recurrence_rule`: an active recurrence rule the operator confirmed
 *   projects this one occurrence.
 *
 * A missing or unrecognised admission refuses the write before any row is read
 * or changed. A goal-cycle policy decision (an INTERNAL_REVERSIBLE "automatic"
 * result included) is not an admission and has no shape here.
 */

export const DAY_DIRECTOR_INSTRUCTION_CHANNELS = [
  /** Day Director, Day Line and Tower Wars procedures behind app sign-in. */
  "authenticated_app",
  /** A Claire conversation turn with the resolved operator (app chat or verified SMS). */
  "claire_conversation",
  /** A Claire voice call with the verified operator. */
  "claire_voice",
] as const;
export type DayDirectorInstructionChannel =
  (typeof DAY_DIRECTOR_INSTRUCTION_CHANNELS)[number];

export type DayDirectorStrategicApproval = NonNullable<
  DayDirectorProposal["strategicApproval"]
>;

export type DayDirectorAdmission =
  | { kind: "strategic_approval"; approval: DayDirectorStrategicApproval }
  | {
      kind: "operator_instruction";
      channel: DayDirectorInstructionChannel;
      /** The authenticated operator's Day Director actor id. */
      operatorActorId: string;
      /** What the operator said or did: a request, turn, call or confirmation reference. */
      instructionRef: string;
    }
  | {
      kind: "operator_recurrence_rule";
      ruleId: string;
      operatorActorId: string;
    };

export type DayDirectorWriteKind =
  | "accept"
  | "complete"
  | "update"
  | "move"
  | "designate_primary";

export const DAY_DIRECTOR_ADMISSION_REFUSALS = [
  "admission_missing",
  "admission_unknown",
  "admission_not_valid_for_write",
  "channel_unknown",
  "instruction_reference_missing",
  "operator_not_owner",
  "strategic_approval_mismatch",
  "strategic_approval_not_recorded",
  "recurrence_rule_mismatch",
  "recurrence_rule_inactive",
  "admission_unverifiable",
] as const;
export type DayDirectorAdmissionRefusal =
  (typeof DAY_DIRECTOR_ADMISSION_REFUSALS)[number];

export class DayDirectorAdmissionError extends Error {
  constructor(public readonly reason: DayDirectorAdmissionRefusal) {
    super(`Day Line write refused: ${reason}`);
    this.name = "DayDirectorAdmissionError";
  }
}

/** What a written row keeps about the authority that admitted it. */
export type DayDirectorAdmissionRecord =
  | { kind: "strategic_approval"; responseId: string }
  | {
      kind: "operator_instruction";
      channel: DayDirectorInstructionChannel;
      instructionRef: string;
    }
  | { kind: "operator_recurrence_rule"; ruleId: string };

type StoredStrategicResponse = {
  action: string;
  revision: string;
  itemIds: string[];
  operatorUserId: string;
};

export type DayDirectorAdmissionDeps = {
  loadStrategicResponse: (input: {
    tenantId: string;
    responseId: string;
    proposalId: string;
    canonicalOperatorId: string;
  }) => Promise<StoredStrategicResponse | null>;
  loadActiveRecurrenceRule: (input: {
    tenantId: string;
    ruleId: string;
    actorId: string;
  }) => Promise<{ id: string } | null>;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function storedResponse(value: unknown): StoredStrategicResponse | null {
  const raw = typeof value === "string" ? safeJson(value) : value;
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  return {
    action: text(row.action),
    revision: text(row.revision),
    itemIds: Array.isArray(row.itemIds) ? row.itemIds.map(String) : [],
    operatorUserId: text(row.operatorUserId),
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export const defaultDayDirectorAdmissionDeps: DayDirectorAdmissionDeps = {
  async loadStrategicResponse(input) {
    const db = await getDb();
    if (!db) throw new DayDirectorAdmissionError("admission_unverifiable");
    const [row] = await db
      .select({ responseJson: strategicProposalResponses.responseJson })
      .from(strategicProposalResponses)
      .where(
        and(
          eq(strategicProposalResponses.tenantId, input.tenantId),
          eq(strategicProposalResponses.id, input.responseId),
          eq(strategicProposalResponses.proposalId, input.proposalId),
          eq(
            strategicProposalResponses.canonicalOperatorId,
            input.canonicalOperatorId
          )
        )
      )
      .limit(1);
    return row ? storedResponse(row.responseJson) : null;
  },
  async loadActiveRecurrenceRule(input) {
    const db = await getDb();
    if (!db) throw new DayDirectorAdmissionError("admission_unverifiable");
    const [row] = await db
      .select({ id: dayDirectorRecurrenceRules.id })
      .from(dayDirectorRecurrenceRules)
      .where(
        and(
          eq(dayDirectorRecurrenceRules.tenantId, input.tenantId),
          eq(dayDirectorRecurrenceRules.id, input.ruleId),
          eq(dayDirectorRecurrenceRules.actorId, input.actorId),
          eq(dayDirectorRecurrenceRules.status, "active")
        )
      )
      .limit(1);
    return row ?? null;
  },
};

function ownsWrite(operatorActorId: unknown, actorIds: readonly string[]): boolean {
  const actor = text(operatorActorId);
  return Boolean(actor) && actor !== "unknown" && actorIds.includes(actor);
}

/**
 * Validates the admission for one Day Director write and returns what the row
 * keeps about it. Throws DayDirectorAdmissionError, with nothing written, when
 * the admission is missing, unrecognised, or does not match the write.
 */
export async function assertDayDirectorWriteAdmission(
  input: {
    admission: DayDirectorAdmission | null | undefined;
    tenantId: string;
    actorIds: readonly string[];
    write: DayDirectorWriteKind;
    proposal?: DayDirectorProposal;
    businessDate?: string;
  },
  deps: DayDirectorAdmissionDeps = defaultDayDirectorAdmissionDeps
): Promise<DayDirectorAdmissionRecord> {
  const admission = input.admission as
    | (Partial<DayDirectorAdmission> & { kind?: unknown })
    | null
    | undefined;
  if (!admission || typeof admission !== "object") {
    throw new DayDirectorAdmissionError("admission_missing");
  }
  const actorIds = input.actorIds.map(id => id.trim()).filter(Boolean);

  if (admission.kind === "operator_instruction") {
    const instruction = admission as Extract<
      DayDirectorAdmission,
      { kind: "operator_instruction" }
    >;
    if (!DAY_DIRECTOR_INSTRUCTION_CHANNELS.includes(instruction.channel)) {
      throw new DayDirectorAdmissionError("channel_unknown");
    }
    if (!ownsWrite(instruction.operatorActorId, actorIds)) {
      throw new DayDirectorAdmissionError("operator_not_owner");
    }
    const instructionRef = text(instruction.instructionRef);
    if (!instructionRef) {
      throw new DayDirectorAdmissionError("instruction_reference_missing");
    }
    // Approval lineage is only ever admitted by the approval it names.
    if (input.proposal?.strategicApproval) {
      throw new DayDirectorAdmissionError("strategic_approval_mismatch");
    }
    return {
      kind: "operator_instruction",
      channel: instruction.channel,
      instructionRef: instructionRef.slice(0, 191),
    };
  }

  if (admission.kind === "strategic_approval") {
    if (input.write !== "accept") {
      throw new DayDirectorAdmissionError("admission_not_valid_for_write");
    }
    const approval = (
      admission as Extract<DayDirectorAdmission, { kind: "strategic_approval" }>
    ).approval;
    const fields = [
      approval?.proposalId,
      approval?.revision,
      approval?.itemId,
      approval?.responseId,
      approval?.canonicalOperatorId,
      approval?.approvedByUserId,
    ];
    if (
      !approval ||
      fields.some(field => !text(field)) ||
      !input.proposal?.strategicApproval ||
      !isDeepStrictEqual(input.proposal.strategicApproval, approval)
    ) {
      throw new DayDirectorAdmissionError("strategic_approval_mismatch");
    }
    const recorded = await deps.loadStrategicResponse({
      tenantId: input.tenantId,
      responseId: approval.responseId,
      proposalId: approval.proposalId,
      canonicalOperatorId: approval.canonicalOperatorId,
    });
    if (
      !recorded ||
      recorded.action !== "approve" ||
      recorded.revision !== approval.revision ||
      !recorded.itemIds.includes(approval.itemId) ||
      recorded.operatorUserId !== approval.approvedByUserId
    ) {
      throw new DayDirectorAdmissionError("strategic_approval_not_recorded");
    }
    return { kind: "strategic_approval", responseId: approval.responseId };
  }

  if (admission.kind === "operator_recurrence_rule") {
    if (input.write !== "accept") {
      throw new DayDirectorAdmissionError("admission_not_valid_for_write");
    }
    const rule = admission as Extract<
      DayDirectorAdmission,
      { kind: "operator_recurrence_rule" }
    >;
    const ruleId = text(rule.ruleId);
    if (!ownsWrite(rule.operatorActorId, actorIds)) {
      throw new DayDirectorAdmissionError("operator_not_owner");
    }
    const businessDate =
      input.proposal?.targetBusinessDate ?? input.businessDate ?? "";
    if (
      !ruleId ||
      !input.proposal ||
      input.proposal.strategicApproval ||
      input.proposal.command?.recurrenceRuleId !== ruleId ||
      input.proposal.promptKey !== `recurrence:${ruleId}:${businessDate}`
    ) {
      throw new DayDirectorAdmissionError("recurrence_rule_mismatch");
    }
    const active = await deps.loadActiveRecurrenceRule({
      tenantId: input.tenantId,
      ruleId,
      actorId: text(rule.operatorActorId),
    });
    if (!active) throw new DayDirectorAdmissionError("recurrence_rule_inactive");
    return { kind: "operator_recurrence_rule", ruleId };
  }

  throw new DayDirectorAdmissionError("admission_unknown");
}

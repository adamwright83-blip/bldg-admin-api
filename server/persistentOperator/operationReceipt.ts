import { and, asc, eq } from "drizzle-orm";
import {
  agentEvents,
  claireProactiveObligations,
  communicationReceipts,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  isMysqlMissingTableError,
  queryOptionalMysqlTable,
} from "../mysqlErrors";
import { getGoalCycleDecision } from "./decisionStore";

export type ReceiptLink<T> =
  | { status: "resolved"; value: T }
  | { status: "unresolved"; reason: string };

function unresolved(reason: string): ReceiptLink<never> {
  return { status: "unresolved", reason };
}

export function isMissingOptionalReceiptTableError(error: unknown): boolean {
  return isMysqlMissingTableError(error);
}

export async function optionalReceiptRows<T>(
  read: () => Promise<T[]>
): Promise<T[]> {
  return queryOptionalMysqlTable(read);
}

export function selectValidatedAuthorityEvent<
  T extends {
    status: string;
    operationStatus?: string | null;
    authorityBasis?: string | null;
    approvalBasis?: string | null;
  },
>(events: readonly T[]): T | undefined {
  return events.find(event => {
    const status = event.operationStatus ?? event.status;
    return (
      status === "execution_started" &&
      (event.authorityBasis != null || event.approvalBasis != null)
    );
  });
}

export function selectedObligationRef(input: {
  selectionKind: string;
  selectedRef: string | null;
}): string | null {
  return input.selectionKind === "obligation" ? input.selectedRef : null;
}

export async function operationReceipt(input: {
  tenantId: string;
  decisionId: string;
}) {
  if (!input.tenantId.trim()) throw new Error("tenantId is required");
  if (!input.decisionId.trim()) throw new Error("decisionId is required");
  const decision = await getGoalCycleDecision(input);
  if (!decision) return null;

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [events, communications, obligations] = await Promise.all([
    optionalReceiptRows(() =>
      db
        .select()
        .from(agentEvents)
        .where(
          and(
            eq(agentEvents.tenantId, input.tenantId),
            eq(agentEvents.decisionId, input.decisionId)
          )
        )
        .orderBy(asc(agentEvents.id))
    ),
    optionalReceiptRows(() =>
      db
        .select()
        .from(communicationReceipts)
        .where(
          and(
            eq(communicationReceipts.tenantId, input.tenantId),
            eq(communicationReceipts.decisionId, input.decisionId)
          )
        )
        .orderBy(asc(communicationReceipts.createdAt))
    ),
    selectedObligationRef(decision)
      ? db
          .select()
          .from(claireProactiveObligations)
          .where(
            and(
              eq(claireProactiveObligations.tenantId, input.tenantId),
              eq(
                claireProactiveObligations.id,
                selectedObligationRef(decision)!
              )
            )
          )
      : Promise.resolve([]),
  ]);

  const authorityEvent = selectValidatedAuthorityEvent(events);
  const executionEvents = events.filter(event =>
    [
      "proposed",
      "policy_denied",
      "write_withheld",
      "approval_required",
      "execution_started",
      "success",
      "succeeded",
      "failed",
    ].includes(event.operationStatus ?? event.status)
  );

  return {
    decisionId: decision.id,
    goalRunId: decision.goalRunId,
    cycleId: decision.cycleId,
    selection: {
      kind: decision.selectionKind,
      selectedRef: decision.selectedRef,
      executionType: decision.selectedExecutionType,
      reasonCode: decision.selectedReasonCode,
      weeklyIntentRef: decision.weeklyIntentId,
      weeklyIntentRevision: decision.weeklyIntentRevision,
      candidateFingerprint: decision.candidateFingerprint,
      missionDirectorPlanRef: decision.missionDirectorPlanId,
      missionDirectorRevision: decision.missionDirectorRevision,
      priorComparableDecisionRef: decision.priorComparableDecisionId,
    },
    evidence: {
      refs: decision.evidenceRefs,
      sourceCoverage: decision.sourceCoverage,
      blockedCandidates: decision.blockedCandidates,
      candidateIds: decision.candidateIds,
      candidateReasonCodes: decision.candidateReasonCodes,
    },
    loadout: decision.loadout,
    experiment: decision.experiment,
    obligations: obligations.map(row => ({
      id: row.id,
      kind: row.kind,
      subjectKey: row.subjectKey,
      status: row.status,
      dueDate: row.dueDate,
      objectiveRef: row.objectiveRef,
      commercialFollowUpRef: row.commercialFollowUpRef,
      agentEventId: row.agentEventId,
    })),
    authority: authorityEvent
      ? {
          status: "resolved" as const,
          value: {
            agentEventId: authorityEvent.id,
            authorityBasis: authorityEvent.authorityBasis,
            approvalBasis: authorityEvent.approvalBasis,
            standingAuthorizationId: authorityEvent.standingAuthorizationId,
            standingAuthorizationVersion:
              authorityEvent.standingAuthorizationVersion,
            policyVersion: authorityEvent.policyVersion,
          },
        }
      : unresolved("no_authority_event_linked"),
    execution: executionEvents.length
      ? {
          status: "resolved" as const,
          value: executionEvents.map(event => ({
            agentEventId: event.id,
            toolName: event.toolName,
            status: event.operationStatus ?? event.status,
            entityType: event.entityType,
            entityId: event.entityId,
            createdAt: event.createdAt.toISOString(),
            errorMessage: event.errorMessage,
          })),
        }
      : unresolved("no_execution_event_linked"),
    communication: communications.length
      ? {
          status: "resolved" as const,
          value: communications.map(item => ({
            receiptId: item.id,
            agentEventId: item.agentEventId,
            eventType: item.eventType,
            callSid: item.callSid,
            messageSid: item.messageSid,
            status: item.status,
            createdAt: item.createdAt.toISOString(),
          })),
        }
      : unresolved("no_communication_receipt_linked"),
    humanObjective: unresolved("slice_h_not_linked"),
    verification: unresolved("verification_not_linked"),
    businessOutcome: unresolved("business_outcome_not_linked"),
    economicObservation: unresolved("economic_observation_not_linked"),
    laterPolicyChange: unresolved("policy_change_not_linked"),
  };
}

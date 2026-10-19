import { randomUUID } from "node:crypto";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { dayDirectorCommitments, observationBridgeObligations } from "../../../drizzle/schema";
import { findAuthoritativeExternalReceipt } from "../../platform/authority/authorityReceipt";
import { strategicResponses } from "../../strategy/strategicStore";
import { getDb } from "../../db";
import { getGoalCycleObjective } from "./objectiveStore";
import { verifyObjectiveExecution } from "./outcomeStore";
import {
  claimDueObservationObligations,
  recordObservationObligation,
  runObservationObligation,
  type ObservationBridgeHandler,
  type ObservationBridgeObligation,
  type ObservationBridgeSettlement,
} from "./observationBridgeStore";

/**
 * Completed Day Line commitment → execution evidence on its goal objective
 * (Phase 2 · Slice C).
 *
 * The commitment is one execution of a Work Thread. Approval recorded which
 * goal objective it serves (`objectiveLineage`) and which thread
 * (`workThread`); completion binds to exactly that objective, never to one
 * found by text or target. What gets recorded is execution evidence only:
 * an `action_verification` outcome, `operator_attested` unless a persisted
 * authoritative external receipt corroborates it. Never revenue, a
 * reactivation or an uplift. Business results are observed separately, inside
 * the observation window approval planned; until then the commitment's
 * observation stays `pending`.
 *
 * Every bridge runs through an observation-bridge obligation keyed by the
 * commitment, so a failure is persisted and retried, and a retried or
 * duplicate completion replays to the same outcome.
 */

export const COMMITMENT_COMPLETION_SOURCE = "day_line_commitment_completion" as const;
const DAY_MS = 86_400_000;

export type CommitmentObservationTarget = { identityKey: string; displayName: string };

/** The observation a completed execution is waiting on, kept on the commitment. */
export type CommitmentObservation = {
  status: "pending" | "result_observed";
  objectiveId: string;
  workThreadId: string | null;
  executionOutcomeId: string;
  windowStart: string;
  /** Null when approval planned no window: results can then only be resolved by evidence, never by elapsed time. */
  windowEnd: string | null;
  targets: CommitmentObservationTarget[];
  results: Array<{ identityKey: string; evidenceReference: string; outcomeId: string; observedAt: string }>;
};

export type CommitmentCompletionPayload = {
  commitmentId: string;
  /** The caller's evidence. A validated external receipt makes it authoritative; anything else is the operator's report. */
  evidenceReference?: string | null;
  evidenceClass?: "authoritative_external" | "operator_attested";
  sourceSystem: string;
  actorId: string;
  explanation?: string | null;
};

export type CommitmentExecutionResult =
  | {
      status: "recorded";
      objectiveId: string;
      outcomeId: string;
      evidenceClass: "authoritative_external" | "operator_attested";
      workThreadId: string | null;
      observation: CommitmentObservation;
    }
  | { status: "unlinked"; reason: "no_approval_lineage" | "no_goal_objective"; message: string }
  | {
      status: "rejected";
      reason:
        | "commitment_not_found"
        | "commitment_not_completed"
        | "approval_unverified"
        | "objective_not_found"
        | "objective_closed"
        | "lineage_mismatch"
        | "authoritative_external_evidence_missing";
      message: string;
    };

type StoredApproval = {
  proposalId: string;
  revision: string;
  itemId: string;
  responseId: string;
  canonicalOperatorId: string;
  approvedByUserId: string;
};

const commitmentEvidenceKey = (commitmentId: string) => `day_director_commitments:${commitmentId}:completed`;

function record(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function plannedTargets(value: unknown): CommitmentObservationTarget[] {
  return Array.isArray(value)
    ? value.flatMap(target => {
        const t = record(target);
        return typeof t.identityKey === "string" && t.identityKey.trim()
          ? [{ identityKey: t.identityKey.trim(), displayName: typeof t.displayName === "string" ? t.displayName : "" }]
          : [];
      })
    : [];
}

/** Read-modify-write of a commitment's metadata under its row lock. `patch` returns null to leave it unchanged. */
export async function mergeCommitmentMetadata(
  tenantId: string,
  commitmentId: string,
  patch: (metadata: Record<string, unknown>) => Record<string, unknown> | null
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const [row] = await tx
      .select({ metadataJson: dayDirectorCommitments.metadataJson })
      .from(dayDirectorCommitments)
      .where(and(eq(dayDirectorCommitments.tenantId, tenantId), eq(dayDirectorCommitments.id, commitmentId)))
      .for("update");
    if (!row) return null;
    const next = patch(record(row.metadataJson));
    if (!next) return record(row.metadataJson);
    await tx
      .update(dayDirectorCommitments)
      .set({ metadataJson: next })
      .where(and(eq(dayDirectorCommitments.tenantId, tenantId), eq(dayDirectorCommitments.id, commitmentId)));
    return next;
  });
}

/**
 * Records the execution evidence for one completed commitment. Idempotent: the
 * outcome is keyed by the commitment's completion, so a retry, a duplicate
 * completion or a reconciliation sweep returns the same outcome.
 */
export async function recordCommitmentExecution(
  input: CommitmentCompletionPayload & { tenantId: string; now?: Date }
): Promise<CommitmentExecutionResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(dayDirectorCommitments)
    .where(and(eq(dayDirectorCommitments.tenantId, input.tenantId), eq(dayDirectorCommitments.id, input.commitmentId)))
    .limit(1);
  if (!row) return { status: "rejected", reason: "commitment_not_found", message: `Commitment ${input.commitmentId} does not exist for this tenant.` };
  if (row.status !== "completed")
    return { status: "rejected", reason: "commitment_not_completed", message: "The commitment is not completed, so there is no execution to record." };

  const metadata = record(row.metadataJson);
  const approval = record(metadata.strategicApproval) as Partial<StoredApproval>;
  if (!approval.proposalId || !approval.responseId || !approval.itemId || !approval.canonicalOperatorId)
    return {
      status: "unlinked",
      reason: "no_approval_lineage",
      message: "It wasn't approved from a strategic proposal, so it isn't linked to a goal objective and can't count toward the goal.",
    };
  // Authority: the approval this commitment carries is the operator's recorded decision.
  const responses = await strategicResponses({ tenantId: input.tenantId, canonicalOperatorId: approval.canonicalOperatorId }, approval.proposalId);
  if (!responses.some(r => r.id === approval.responseId && r.action === "approve" && r.itemIds.includes(approval.itemId!)))
    return { status: "rejected", reason: "approval_unverified", message: "Its approval could not be matched to a recorded operator decision, so nothing was recorded against the goal." };

  const lineage = record(metadata.objectiveLineage);
  const objectiveId = typeof lineage.objectiveId === "string" ? lineage.objectiveId : null;
  if (!objectiveId)
    return {
      status: "unlinked",
      reason: "no_goal_objective",
      message: "When it was approved there was no open goal objective for it, so its results can't count toward the goal.",
    };
  const objective = await getGoalCycleObjective({ tenantId: input.tenantId, objectiveId });
  if (!objective) return { status: "rejected", reason: "objective_not_found", message: `Its approved goal objective ${objectiveId} no longer exists.` };
  const threadId = typeof record(metadata.workThread).id === "string" ? (record(metadata.workThread).id as string) : null;
  if (objective.canonicalOperatorId !== approval.canonicalOperatorId || (threadId && objective.workThreadId && objective.workThreadId !== threadId))
    return { status: "rejected", reason: "lineage_mismatch", message: "Its approval and its goal objective point at different work; it needs review before anything is recorded." };
  if (["completed", "failed", "cancelled"].includes(objective.status))
    return { status: "rejected", reason: "objective_closed", message: `Its goal objective is already ${objective.status}.` };

  // Evidence: the operator's report unless a persisted external receipt corroborates it.
  const callerReference = input.evidenceReference?.trim() || null;
  const external = callerReference
    ? await findAuthoritativeExternalReceipt({ tenantId: input.tenantId, evidenceReference: callerReference })
    : null;
  if (input.evidenceClass === "authoritative_external" && !external)
    return {
      status: "rejected",
      reason: "authoritative_external_evidence_missing",
      message: "The external confirmation it cited could not be found, so it was not recorded as confirmed.",
    };
  const evidenceClass = external ? "authoritative_external" : "operator_attested";
  const completedAt = row.completedAt ?? input.now ?? new Date();
  const verification = await verifyObjectiveExecution({
    tenantId: input.tenantId,
    objectiveId,
    // The commitment's completion is the source event, so every replay keys the same outcome.
    evidenceReference: external ? callerReference! : commitmentEvidenceKey(row.id),
    evidenceClass,
    sourceSystem: input.sourceSystem,
    outcomeKind: "action_verification",
    explanation:
      input.explanation ??
      (evidenceClass === "operator_attested"
        ? `Operator reported the approved work done: ${row.title}`
        : `Approved work done, confirmed by external evidence: ${row.title}`),
    observedAt: completedAt,
    transitionObjectiveTo: "action_executed",
    statusReason: `Approved commitment ${row.id} completed; results pending observation`,
    metadata: {
      commitmentId: row.id,
      workThreadId: threadId,
      approval: { proposalId: approval.proposalId, revision: approval.revision, itemId: approval.itemId, responseId: approval.responseId },
      reportedBy: input.actorId,
      ...(callerReference && !external ? { operatorReference: callerReference } : {}),
      ...(external ? { authorityReceiptId: external.id } : {}),
    },
  });

  const plan = record(metadata.observationPlan);
  const windowDays = typeof plan.windowDays === "number" && plan.windowDays > 0 ? plan.windowDays : null;
  const observationDraft: CommitmentObservation = {
    status: "pending",
    objectiveId,
    workThreadId: threadId,
    executionOutcomeId: verification.outcome.id,
    windowStart: completedAt.toISOString(),
    windowEnd: windowDays ? new Date(completedAt.getTime() + windowDays * DAY_MS).toISOString() : null,
    targets: plannedTargets(plan.targets),
    results: [],
  };
  const merged = await mergeCommitmentMetadata(input.tenantId, row.id, current =>
    current.observation ? null : { ...current, observation: observationDraft }
  );
  const observation = (merged?.observation as CommitmentObservation | undefined) ?? observationDraft;
  return { status: "recorded", objectiveId, outcomeId: verification.outcome.id, evidenceClass, workThreadId: threadId, observation };
}

/** How one execution attempt settles its obligation. */
export function settlementForExecution(result: CommitmentExecutionResult): ObservationBridgeSettlement {
  if (result.status === "recorded") return { status: "bridged", result };
  if (result.status === "unlinked") return { status: "unrelated", result };
  return { status: result.reason === "lineage_mismatch" ? "ambiguous_review" : "rejected", result };
}

export const commitmentCompletionHandler: ObservationBridgeHandler = async obligation =>
  settlementForExecution(
    await recordCommitmentExecution({
      tenantId: obligation.tenantId,
      ...(obligation.payload as unknown as CommitmentCompletionPayload),
    })
  );

/** What the operator is told about a completion's goal evidence. */
export type CommitmentGoalEvidence =
  | { status: "recorded"; objectiveId: string; evidenceClass: "authoritative_external" | "operator_attested"; observation: CommitmentObservation; message: string }
  | { status: "unlinked" | "rejected" | "needs_review"; reason: string; message: string }
  | { status: "pending_retry"; obligationId: string; message: string };

function goalEvidenceFor(obligation: ObservationBridgeObligation, settlement?: ObservationBridgeSettlement): CommitmentGoalEvidence {
  const status = settlement?.status ?? obligation.status;
  const result = (settlement?.result ?? obligation.result ?? null) as CommitmentExecutionResult | null;
  if (status === "bridged" && result?.status === "recorded") {
    const until = result.observation.windowEnd
      ? ` until ${new Date(result.observation.windowEnd).toISOString().slice(0, 10)}`
      : "";
    return {
      status: "recorded",
      objectiveId: result.objectiveId,
      evidenceClass: result.evidenceClass,
      observation: result.observation,
      message:
        result.evidenceClass === "operator_attested"
          ? `Logged on the goal as your report of the work; its results are pending${until}.`
          : `Logged on the goal with external confirmation; its results are pending${until}.`,
    };
  }
  if (result && result.status !== "recorded" && (status === "unrelated" || status === "rejected" || status === "ambiguous_review"))
    return { status: status === "ambiguous_review" ? "needs_review" : result.status, reason: result.reason, message: result.message };
  return {
    status: "pending_retry",
    obligationId: obligation.id,
    message: "Recording it on the goal didn't finish; it will retry automatically.",
  };
}

/**
 * The completion path's bridge: record the obligation, then try it now under a
 * lease. A failure leaves the obligation pending for the reconciliation sweep
 * and is reported as pending, never as verified.
 */
export async function bridgeCommitmentCompletion(
  input: CommitmentCompletionPayload & { tenantId: string; now?: Date },
  deps: { handler?: ObservationBridgeHandler } = {}
): Promise<CommitmentGoalEvidence> {
  const payload: CommitmentCompletionPayload = {
    commitmentId: input.commitmentId,
    evidenceReference: input.evidenceReference ?? null,
    ...(input.evidenceClass ? { evidenceClass: input.evidenceClass } : {}),
    sourceSystem: input.sourceSystem,
    actorId: input.actorId,
    explanation: input.explanation ?? null,
  };
  const obligation = await recordObservationObligation({
    tenantId: input.tenantId,
    sourceKind: COMMITMENT_COMPLETION_SOURCE,
    sourceKey: input.commitmentId,
    payload: payload as unknown as Record<string, unknown>,
    now: input.now,
  });
  if (obligation.status !== "pending" && obligation.status !== "unresolved_identity") return goalEvidenceFor(obligation);
  const leaseOwner = `commitment-completion:${randomUUID()}`;
  const [claimed] = await claimDueObservationObligations({ leaseOwner, ids: [obligation.id], limit: 1, now: input.now, tenantId: input.tenantId });
  if (!claimed) return goalEvidenceFor(obligation); // another worker holds it, or its retry is not due yet
  const { settlement } = await runObservationObligation({
    obligation: claimed,
    handler: deps.handler ?? commitmentCompletionHandler,
    leaseOwner,
    now: input.now,
  });
  return goalEvidenceFor(claimed, settlement);
}

/**
 * Reconciliation: completed, approved commitments with no obligation yet (a
 * crash right after completion, or a completion path that does not bridge,
 * such as the Day Director's own complete control) get one, so the drain
 * records their execution evidence.
 */
export async function enqueueCompletedCommitmentObligations(input: {
  since: Date;
  tenantId?: string;
  limit?: number;
  now?: Date;
}): Promise<{ enqueued: number }> {
  const db = await getDb();
  if (!db) return { enqueued: 0 };
  const conditions = [
    eq(dayDirectorCommitments.status, "completed"),
    isNotNull(dayDirectorCommitments.completedAt),
    gte(dayDirectorCommitments.completedAt, input.since),
    sql`JSON_EXTRACT(${dayDirectorCommitments.metadataJson}, '$.strategicApproval') IS NOT NULL`,
    sql`NOT EXISTS (SELECT 1 FROM ${observationBridgeObligations} o WHERE o.tenantId = ${dayDirectorCommitments.tenantId} AND o.sourceKind = ${COMMITMENT_COMPLETION_SOURCE} AND o.sourceKey = ${dayDirectorCommitments.id})`,
  ];
  if (input.tenantId) conditions.push(eq(dayDirectorCommitments.tenantId, input.tenantId));
  const rows = await db
    .select({ id: dayDirectorCommitments.id, tenantId: dayDirectorCommitments.tenantId, actorId: dayDirectorCommitments.actorId })
    .from(dayDirectorCommitments)
    .where(and(...conditions))
    .limit(input.limit ?? 50);
  for (const row of rows)
    await recordObservationObligation({
      tenantId: row.tenantId,
      sourceKind: COMMITMENT_COMPLETION_SOURCE,
      sourceKey: row.id,
      payload: { commitmentId: row.id, evidenceReference: null, sourceSystem: "day_director", actorId: row.actorId, explanation: null },
      now: input.now,
    });
  return { enqueued: rows.length };
}

export type ObservedAttemptMatch =
  | { status: "none" }
  | { status: "ambiguous"; objectiveIds: string[]; commitmentIds: string[] }
  | {
      status: "matched";
      commitmentId: string;
      objectiveId: string;
      workThreadId: string | null;
      identityKey: string;
      windowStart: string;
      windowEnd: string;
    };

/**
 * The executed attempt a paid order answers: a completed commitment whose
 * observation targeted this customer and whose window covers the payment.
 * A paid order with no such attempt is not this work's result. Attempts on
 * more than one objective are ambiguous and never resolved by guessing.
 */
export async function findObservedAttemptForPaidOrder(input: {
  tenantId: string;
  identityKeys: readonly string[];
  paidAt: Date;
}): Promise<ObservedAttemptMatch> {
  if (!input.identityKeys.length) return { status: "none" };
  const db = await getDb();
  // No database configured: no attempt can be on record (a failing query still throws).
  if (!db) return { status: "none" };
  const rows = await db
    .select({ id: dayDirectorCommitments.id, metadataJson: dayDirectorCommitments.metadataJson })
    .from(dayDirectorCommitments)
    .where(
      and(
        eq(dayDirectorCommitments.tenantId, input.tenantId),
        eq(dayDirectorCommitments.status, "completed"),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${dayDirectorCommitments.metadataJson}, '$.observation.status')) IN ('pending', 'result_observed')`
      )
    );
  const keys = new Set(input.identityKeys);
  const paid = input.paidAt.getTime();
  const matches = rows.flatMap(row => {
    const observation = record(record(row.metadataJson).observation) as Partial<CommitmentObservation>;
    if (!observation.windowEnd || !observation.windowStart || !observation.objectiveId) return [];
    if (paid < Date.parse(observation.windowStart) || paid > Date.parse(observation.windowEnd)) return [];
    const target = (observation.targets ?? []).find(t => keys.has(t.identityKey));
    return target
      ? [{ commitmentId: row.id, objectiveId: observation.objectiveId, workThreadId: observation.workThreadId ?? null, identityKey: target.identityKey, windowStart: observation.windowStart, windowEnd: observation.windowEnd }]
      : [];
  });
  if (!matches.length) return { status: "none" };
  const objectiveIds = [...new Set(matches.map(m => m.objectiveId))];
  if (objectiveIds.length > 1)
    return { status: "ambiguous", objectiveIds: objectiveIds.sort(), commitmentIds: matches.map(m => m.commitmentId).sort() };
  // One objective: the latest contact before the payment is the attempt it answers.
  const [latest] = [...matches].sort((a, b) => Date.parse(b.windowStart) - Date.parse(a.windowStart));
  return { status: "matched", ...latest! };
}

/** Records a verified result on the attempt's observation, once per evidence reference. */
export async function recordAttemptObservationResult(input: {
  tenantId: string;
  commitmentId: string;
  identityKey: string;
  evidenceReference: string;
  outcomeId: string;
  observedAt: Date;
}): Promise<void> {
  await mergeCommitmentMetadata(input.tenantId, input.commitmentId, current => {
    const observation = record(current.observation) as Partial<CommitmentObservation>;
    if (!observation.objectiveId) return null;
    const results = observation.results ?? [];
    if (results.some(r => r.evidenceReference === input.evidenceReference)) return null;
    return {
      ...current,
      observation: {
        ...observation,
        status: "result_observed",
        results: [
          ...results,
          { identityKey: input.identityKey, evidenceReference: input.evidenceReference, outcomeId: input.outcomeId, observedAt: input.observedAt.toISOString() },
        ],
      },
    };
  });
}

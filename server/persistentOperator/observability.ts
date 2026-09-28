import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, ne } from "drizzle-orm";
import {
  dayDirectorCommitments,
  goldlineWorldEvents,
  persistentOperatorDiagnosticEvents,
} from "../../drizzle/schema";
import { loadBusinessSourceCoverage } from "../analytics/sourceCoverage";
import { loadObligations } from "../claire/proactive/boardService";
import { getDb } from "../db";

export const PERSISTENT_OPERATOR_EMPTY_REASONS = [
  "legitimate_no_work",
  "identity_unresolved",
  "identity_ambiguous",
  "campaign_unmatched",
  "run_unmatched",
  "day_line_unavailable",
  "source_unavailable",
  "coverage_incomplete",
  "authority_withheld",
  "policy_denied",
  "waiting_on_human",
  "waiting_on_external_result",
] as const;
export type PersistentOperatorEmptyReason =
  (typeof PERSISTENT_OPERATOR_EMPTY_REASONS)[number];

export const PERSISTENT_OPERATOR_DIAGNOSTIC_EVENT_KINDS = [
  "selection_attempt",
  "identity_join_failure",
  "objective_created",
  "objective_surfaced",
  "objective_started",
  "objective_verified",
] as const;
export type PersistentOperatorDiagnosticEventKind =
  (typeof PERSISTENT_OPERATOR_DIAGNOSTIC_EVENT_KINDS)[number];

export type PersistentOperatorDiagnosticEventInput = {
  tenantId: string;
  canonicalOperatorId?: string | null;
  operatorUserId?: string | null;
  subsystem: string;
  eventKind: PersistentOperatorDiagnosticEventKind;
  reason?: PersistentOperatorEmptyReason | null;
  sourceIdentityType?: string | null;
  targetIdentityType?: string | null;
  objectiveId?: string | null;
  occurredAt?: Date;
};

export async function recordPersistentOperatorDiagnosticEvent(
  input: PersistentOperatorDiagnosticEventInput
): Promise<void> {
  const tenantId = input.tenantId.trim();
  if (!tenantId) throw new Error("persistent operator diagnostic requires tenantId");
  const db = await getDb();
  if (!db) return;
  await db.insert(persistentOperatorDiagnosticEvents).values({
    id: randomUUID(),
    tenantId,
    canonicalOperatorId: input.canonicalOperatorId ?? null,
    operatorUserId: input.operatorUserId ?? null,
    subsystem: input.subsystem,
    eventKind: input.eventKind,
    reason: input.reason ?? null,
    sourceIdentityType: input.sourceIdentityType ?? null,
    targetIdentityType: input.targetIdentityType ?? null,
    objectiveId: input.objectiveId ?? null,
    occurredAt: input.occurredAt ?? new Date(),
  });
}

function groupedReasons(
  rows: Array<{ reason: string | null }>
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    if (!row.reason) continue;
    result[row.reason] = (result[row.reason] ?? 0) + 1;
  }
  return result;
}

function distinctObjectiveCount(
  rows: Array<{ eventKind: string; objectiveId: string | null }>,
  eventKind: string
): number {
  return new Set(
    rows
      .filter(row => row.eventKind === eventKind && row.objectiveId)
      .map(row => row.objectiveId!)
  ).size;
}

function daysOld(ymd: string, today: string): number {
  const due = Date.parse(`${ymd}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(due) && Number.isFinite(now)
    ? Math.max(0, Math.floor((now - due) / 86_400_000))
    : 0;
}

export async function loadPersistentOperatorDiagnostics(input: {
  tenantId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
  dayDirectorActorId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const today = now.toISOString().slice(0, 10);
  const db = await getDb();

  const eventRows = db
    ? await db
        .select()
        .from(persistentOperatorDiagnosticEvents)
        .where(
          and(
            eq(persistentOperatorDiagnosticEvents.tenantId, input.tenantId),
            eq(
              persistentOperatorDiagnosticEvents.canonicalOperatorId,
              input.canonicalOperatorId
            ),
            gte(persistentOperatorDiagnosticEvents.occurredAt, since)
          )
        )
        .orderBy(desc(persistentOperatorDiagnosticEvents.occurredAt))
        .limit(5000)
    : [];

  const attempts = eventRows.filter(row => row.eventKind === "selection_attempt");
  const silentAttempts = attempts.filter(row => row.reason != null);
  const identityFailures = eventRows.filter(
    row => row.eventKind === "identity_join_failure"
  );

  const obligations = await loadObligations(
    input.tenantId,
    input.operatorUserId
  ).catch(() => []);
  const dueObligations = obligations.filter(
    obligation =>
      obligation.status !== "completed" &&
      obligation.status !== "cancelled" &&
      obligation.status !== "superseded"
  );

  const openCommitments = db
    ? await db
        .select({
          id: dayDirectorCommitments.id,
          businessDate: dayDirectorCommitments.businessDate,
          createdAt: dayDirectorCommitments.createdAt,
        })
        .from(dayDirectorCommitments)
        .where(
          and(
            eq(dayDirectorCommitments.tenantId, input.tenantId),
            eq(dayDirectorCommitments.actorId, input.dayDirectorActorId),
            eq(dayDirectorCommitments.status, "open")
          )
        )
    : [];

  const oldestCandidates = [
    ...dueObligations.map(obligation => ({
      kind: "obligation" as const,
      id: obligation.id,
      dueDate: obligation.dueDate,
      ageDays: daysOld(obligation.dueDate, today),
      status: obligation.status,
    })),
    ...openCommitments.map(commitment => ({
      kind: "scheduled_work" as const,
      id: commitment.id,
      dueDate: commitment.businessDate,
      ageDays: daysOld(commitment.businessDate, today),
      status: "open",
    })),
  ].sort((a, b) => b.ageDays - a.ageDays);

  const sourceCoverage = await loadBusinessSourceCoverage({
    tenantId: input.tenantId,
    now,
  });

  const truthRows = db
    ? await db
        .select({
          verificationClass: goldlineWorldEvents.verificationClass,
          provenanceClass: goldlineWorldEvents.provenanceClass,
          confidence: goldlineWorldEvents.confidence,
          classification: goldlineWorldEvents.classification,
        })
        .from(goldlineWorldEvents)
        .where(
          and(
            eq(goldlineWorldEvents.tenantId, input.tenantId),
            gte(goldlineWorldEvents.occurredAt, since),
            ne(goldlineWorldEvents.classification, "game_projection")
          )
        )
        .limit(10000)
    : [];

  const denominator = truthRows.length;
  const exact = truthRows.filter(row => row.verificationClass === "VERIFIED").length;
  const recordedOnly = truthRows.filter(
    row =>
      row.provenanceClass === "existing_business_record" &&
      row.verificationClass !== "VERIFIED"
  ).length;
  const platformReported = truthRows.filter(
    row => row.provenanceClass === "provider_verified"
  ).length;
  const missingUnknown = truthRows.filter(
    row =>
      row.confidence === "unknown" ||
      row.verificationClass === "CLAIMED"
  ).length;

  return {
    window: {
      days: 30,
      since: since.toISOString(),
      through: now.toISOString(),
    },
    silentIdle: {
      attempts: attempts.length,
      silent: silentAttempts.length,
      rate: attempts.length ? silentAttempts.length / attempts.length : null,
      byReason: groupedReasons(silentAttempts),
    },
    initiationFunnel: {
      objectiveCreated: distinctObjectiveCount(eventRows, "objective_created"),
      objectiveSurfaced: distinctObjectiveCount(eventRows, "objective_surfaced"),
      objectiveStarted: distinctObjectiveCount(eventRows, "objective_started"),
      objectiveVerified: distinctObjectiveCount(eventRows, "objective_verified"),
      basis: "persisted_diagnostic_objective_transition_events" as const,
    },
    oldestDueWork: oldestCandidates[0] ?? null,
    truthCoverage: {
      basis: "goldline_world_events_plus_canonical_source_coverage" as const,
      observations: denominator,
      exact: {
        count: exact,
        proportion: denominator ? exact / denominator : null,
      },
      recordedOnly: {
        count: recordedOnly,
        proportion: denominator ? recordedOnly / denominator : null,
      },
      platformReported: {
        count: platformReported,
        proportion: denominator ? platformReported / denominator : null,
      },
      missingUnknown: {
        count: missingUnknown,
        proportion: denominator ? missingUnknown / denominator : null,
      },
      conflicting: {
        count: null,
        proportion: null,
        reason:
          "goldline_world_events has no standalone conflicting state; no conflict count is invented",
      },
      sourceCoverage: {
        bookStatus: sourceCoverage.book.status,
        current: sourceCoverage.book.current,
        exhaustiveCurrent: sourceCoverage.book.exhaustiveCurrent,
        blockingSources: sourceCoverage.blockingSources,
      },
    },
    identityJoinFailures: {
      total: identityFailures.length,
      byReason: groupedReasons(identityFailures),
      recent: identityFailures.slice(0, 25).map(row => ({
        subsystem: row.subsystem,
        sourceIdentityType: row.sourceIdentityType,
        targetIdentityType: row.targetIdentityType,
        reason: row.reason,
        occurredAt: row.occurredAt.toISOString(),
      })),
    },
  };
}

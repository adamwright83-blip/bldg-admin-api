import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import {
  dayDirectorCommitments,
  goldlineWorldEvents,
  persistentOperatorDiagnosticEvents,
} from "../../drizzle/schema";
import { loadBusinessSourceCoverage } from "../analytics/sourceCoverage";
import { getDashboardTimeZone } from "../dashboardZoned";
import { businessDateInZone } from "../../shared/currentDayLine";
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

type DiagnosticSummaryRow = {
  eventKind: string;
  reason: string | null;
  objectiveId: string | null;
  occurredAt: Date;
};

export function summarizeSilentIdle(rows: DiagnosticSummaryRow[]) {
  const attempts = rows.filter(row => row.eventKind === "selection_attempt");
  const silent = attempts.filter(row => row.reason != null);
  return {
    attempts: attempts.length,
    silent: silent.length,
    rate: attempts.length ? silent.length / attempts.length : null,
    byReason: groupedReasons(silent),
  };
}

function mondayForBusinessDate(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function summarizeInitiationFunnelByBusinessWeek(
  rows: DiagnosticSummaryRow[],
  timeZone: string
) {
  const byWeek = new Map<
    string,
    Array<{ eventKind: string; objectiveId: string | null }>
  >();
  for (const row of rows) {
    if (
      ![
        "objective_created",
        "objective_surfaced",
        "objective_started",
        "objective_verified",
      ].includes(row.eventKind)
    ) {
      continue;
    }
    const businessDate = businessDateInZone(row.occurredAt, timeZone);
    const weekStart = mondayForBusinessDate(businessDate);
    const bucket = byWeek.get(weekStart) ?? [];
    bucket.push(row);
    byWeek.set(weekStart, bucket);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, bucket]) => ({
      weekStart,
      objectiveCreated: distinctObjectiveCount(bucket, "objective_created"),
      objectiveSurfaced: distinctObjectiveCount(bucket, "objective_surfaced"),
      objectiveStarted: distinctObjectiveCount(bucket, "objective_started"),
      objectiveVerified: distinctObjectiveCount(bucket, "objective_verified"),
    }));
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
  operatorUserIds?: string[];
  dayDirectorActorId: string;
  dayDirectorActorIds?: string[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const timeZone = getDashboardTimeZone();
  const today = businessDateInZone(now, timeZone);
  const db = await getDb();

  const [eventRows, identityFailures] = db
    ? await Promise.all([
        db
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
          .limit(5000),
        db
          .select()
          .from(persistentOperatorDiagnosticEvents)
          .where(
            and(
              eq(persistentOperatorDiagnosticEvents.tenantId, input.tenantId),
              eq(
                persistentOperatorDiagnosticEvents.eventKind,
                "identity_join_failure"
              ),
              gte(persistentOperatorDiagnosticEvents.occurredAt, since)
            )
          )
          .orderBy(desc(persistentOperatorDiagnosticEvents.occurredAt))
          .limit(5000),
      ])
    : [[], []];
  const silentIdle = summarizeSilentIdle(eventRows);
  const initiationFunnel = summarizeInitiationFunnelByBusinessWeek(
    eventRows,
    timeZone
  );

  const authorizedOperatorUserIds = [...new Set(
    (input.operatorUserIds?.length ? input.operatorUserIds : [input.operatorUserId])
      .map(operatorUserId => operatorUserId.trim())
      .filter(Boolean)
  )];
  const obligationGroups = await Promise.all(
    authorizedOperatorUserIds.map(operatorUserId =>
      loadObligations(input.tenantId, operatorUserId).catch(() => [])
    )
  );
  const obligations = [...new Map(
    obligationGroups.flat().map(obligation => [obligation.id, obligation] as const)
  ).values()];
  const dueObligations = obligations.filter(
    obligation =>
      obligation.status !== "completed" &&
      obligation.status !== "cancelled" &&
      obligation.status !== "superseded" &&
      (obligation.dueDate <= today ||
        obligation.status === "awaiting_result" ||
        obligation.status === "draft_prepared")
  );

  const authorizedActorIds = [...new Set(
    (input.dayDirectorActorIds?.length
      ? input.dayDirectorActorIds
      : [input.dayDirectorActorId]
    )
      .map(actorId => actorId.trim())
      .filter(Boolean)
  )];
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
            inArray(dayDirectorCommitments.actorId, authorizedActorIds),
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
    ...openCommitments
      .filter(commitment => commitment.businessDate <= today)
      .map(commitment => ({
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
    silentIdle,
    initiationFunnel: {
      byBusinessWeek: initiationFunnel,
      timeZone,
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
      staleSources: {
        count: sourceCoverage.sources.filter(
          source => source.includedInCombinedBook && source.status === "stale"
        ).length,
        proportion: sourceCoverage.sources.filter(
          source => source.includedInCombinedBook
        ).length
          ? sourceCoverage.sources.filter(
              source => source.includedInCombinedBook && source.status === "stale"
            ).length /
            sourceCoverage.sources.filter(source => source.includedInCombinedBook)
              .length
          : null,
        basis: "canonical_source_coverage_sources" as const,
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

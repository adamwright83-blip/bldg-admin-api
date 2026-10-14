import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { addDaysYmd } from "../../analytics/businessPeriods";

/** Claire asks only about work that went unfinished within this many days. */
export const FOLLOW_UP_WINDOW_DAYS = 7;
import { dayDirectorCommitments, daphneObservations } from "../../../drizzle/schema";
import { getDb } from "../../db";
import {
  mergeDayLineOverlay,
  readDayLineOverlay,
  type DayLineUnresolvedWork,
} from "../../../shared/goldlineDayLine";
import {
  classifyMissionExplanation,
  describeMissionAdjustment,
  missionFollowUpQuestion,
  parseMissionAdjustment,
  type DaphneExplanationClassification,
  type DaphneMissionFollowUp,
  type DaphneMissionPresentation,
} from "../../../shared/daphneMissionPresentation";
import { recordDaphneObservation } from "./observationStore";
import { daphneAdaptationAllowed, loadDaphneMetaPreferences } from "./goalsPreferences";

/** The Daphne observation source that carries operator-approved presentation adjustments. */
export const MISSION_PRESENTATION_SOURCE = "daphne_mission_presentation";

type Scope = {
  tenantId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
  actorIds: readonly string[];
};

export function commitmentMissionType(row: {
  kind: string;
  metadataJson: unknown;
}): string {
  const meta =
    row.metadataJson && typeof row.metadataJson === "object"
      ? (row.metadataJson as Record<string, unknown>)
      : {};
  return typeof meta.missionType === "string" && meta.missionType
    ? meta.missionType
    : row.kind;
}

async function writeUnresolved(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  row: typeof dayDirectorCommitments.$inferSelect,
  unresolved: DayLineUnresolvedWork
) {
  await db
    .update(dayDirectorCommitments)
    .set({ metadataJson: mergeDayLineOverlay(row.metadataJson, { unresolved }) })
    .where(
      and(
        eq(dayDirectorCommitments.tenantId, row.tenantId),
        eq(dayDirectorCommitments.id, row.id),
        // Only open work is unresolved; never overwrite a completion.
        eq(dayDirectorCommitments.status, "open")
      )
    );
}

/**
 * Marks open Day Line items whose business date has passed as unresolved work,
 * records the system observation in Daphne, and returns Claire's one question
 * for the oldest item still awaiting an explanation.
 */
export async function syncMissionFollowUp(
  input: Scope & { today: string; now?: Date }
): Promise<DaphneMissionFollowUp | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  if (!input.actorIds.length) return null;
  const now = input.now ?? new Date();
  const rows = await db
    .select()
    .from(dayDirectorCommitments)
    .where(
      and(
        eq(dayDirectorCommitments.tenantId, input.tenantId),
        inArray(dayDirectorCommitments.actorId, [...input.actorIds]),
        eq(dayDirectorCommitments.status, "open"),
        lt(dayDirectorCommitments.businessDate, input.today),
        // Recent work only: an old backlog stays as recorded, never auto-questioned.
        gte(dayDirectorCommitments.businessDate, addDaysYmd(input.today, -FOLLOW_UP_WINDOW_DAYS))
      )
    )
    .orderBy(desc(dayDirectorCommitments.businessDate));
  let pending: DaphneMissionFollowUp | null = null;
  for (const row of rows) {
    const overlay = readDayLineOverlay(row.metadataJson);
    if (overlay.cancelledAt || overlay.notPursuing) continue;
    const missionType = commitmentMissionType(row);
    let unresolved = overlay.unresolved;
    if (!unresolved) {
      const observation = await recordDaphneObservation({
        tenantId: input.tenantId,
        canonicalOperatorId: input.canonicalOperatorId,
        operatorUserId: input.operatorUserId,
        actorType: "system",
        actorId: "day_line",
        observationKind: "system_context_event",
        evidenceChannel: "system_record",
        verificationStatus: "verified",
        sourceType: "day_director_commitment",
        sourceReference: `day_director_commitments:${row.id}`,
        occurredAt: now,
        payload: {
          status: "open_after_business_date",
          interpretation: "unresolved_work_not_proof_of_skip",
          businessDate: row.businessDate,
          missionType,
        },
        idempotencyKey: `day_line_unresolved:${row.id}`,
      });
      unresolved = {
        observedAt: now.toISOString(),
        observationId: observation.id,
        status: "awaiting_explanation",
      };
      await writeUnresolved(db, row, unresolved);
    }
    if (!pending && unresolved.status === "awaiting_explanation")
      pending = {
        commitmentId: row.id,
        businessDate: row.businessDate,
        title: row.title,
        missionType,
        question: missionFollowUpQuestion(missionType),
      };
  }
  return pending;
}

/**
 * Records the operator's explanation durably. Only an explicit, recognised
 * reason with adaptation consent becomes a presentation adjustment; the
 * unresolved item itself stays open and unchanged.
 */
export async function answerMissionFollowUp(
  input: Scope & { commitmentId: string; answer: string; now?: Date }
): Promise<{
  classification: DaphneExplanationClassification;
  explanationObservationId: string;
  adjustmentObservationId: string | null;
  adjustmentApplied: boolean;
  reply: string;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const answer = input.answer.trim().slice(0, 2000);
  if (!answer) throw new Error("An explanation is required");
  const now = input.now ?? new Date();
  const [row] = await db
    .select()
    .from(dayDirectorCommitments)
    .where(
      and(
        eq(dayDirectorCommitments.tenantId, input.tenantId),
        eq(dayDirectorCommitments.id, input.commitmentId),
        inArray(dayDirectorCommitments.actorId, [...input.actorIds])
      )
    )
    .limit(1);
  if (!row) throw new Error("Day Line item not found");
  const overlay = readDayLineOverlay(row.metadataJson);
  if (!overlay.unresolved) throw new Error("This item is not awaiting an explanation");
  const missionType = commitmentMissionType(row);
  const classification = classifyMissionExplanation(answer);
  const sourceReference = `day_director_commitments:${row.id}`;
  const explanation = await recordDaphneObservation({
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
    operatorUserId: input.operatorUserId,
    actorType: "user",
    actorId: input.operatorUserId,
    observationKind: "user_statement",
    evidenceChannel: "stated",
    verificationStatus: "attested",
    sourceType: "day_line_unresolved_explanation",
    sourceReference,
    occurredAt: now,
    payload: {
      answer,
      missionType,
      reason: classification.reason,
      epistemic: classification.epistemic,
      unresolvedObservationId: overlay.unresolved.observationId,
    },
    idempotencyKey: `day_line_explanation:${row.id}:${overlay.unresolved.observationId}`,
  });
  let adjustmentObservationId: string | null = null;
  const allowed = daphneAdaptationAllowed(
    await loadDaphneMetaPreferences({
      tenantId: input.tenantId,
      canonicalOperatorId: input.canonicalOperatorId,
    })
  );
  if (classification.epistemic === "explicit" && classification.adjustment && allowed) {
    const adjustment = await recordDaphneObservation({
      tenantId: input.tenantId,
      canonicalOperatorId: input.canonicalOperatorId,
      operatorUserId: input.operatorUserId,
      actorType: "user",
      actorId: input.operatorUserId,
      observationKind: "preference_declaration",
      evidenceChannel: "stated",
      verificationStatus: "attested",
      sourceType: MISSION_PRESENTATION_SOURCE,
      sourceReference: `daphne_observations:${explanation.id}`,
      occurredAt: now,
      payload: { missionType, adjustment: classification.adjustment, revoked: false },
      idempotencyKey: `mission_presentation:${explanation.id}`,
    });
    adjustmentObservationId = adjustment.id;
  }
  await writeUnresolved(db, row, {
    ...overlay.unresolved,
    status: "explained",
    explanationObservationId: explanation.id,
    reason: classification.reason,
  });
  const reply = adjustmentObservationId
    ? `Thanks. ${describeMissionAdjustment(classification.adjustment!)} The work itself stays the same.`
    : classification.reason === "blocked"
      ? "Understood — that was outside your control. I've noted it and left the work as it was."
      : classification.adjustment && !allowed
        ? "Noted. Adaptation is turned off, so I haven't changed how missions are presented."
        : "Noted, in your words. I won't guess at a reason or change anything from that.";
  return {
    classification,
    explanationObservationId: explanation.id,
    adjustmentObservationId,
    adjustmentApplied: adjustmentObservationId != null,
    reply,
  };
}

/** Operator revocation: the next missions of this type return to default presentation. */
export async function revokeMissionPresentation(
  input: Scope & { missionType: string; now?: Date }
): Promise<string> {
  const now = input.now ?? new Date();
  const record = await recordDaphneObservation({
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
    operatorUserId: input.operatorUserId,
    actorType: "user",
    actorId: input.operatorUserId,
    observationKind: "correction",
    evidenceChannel: "stated",
    verificationStatus: "attested",
    sourceType: MISSION_PRESENTATION_SOURCE,
    sourceReference: `mission_type:${input.missionType}`,
    occurredAt: now,
    payload: { missionType: input.missionType, adjustment: null, revoked: true },
    idempotencyKey: `mission_presentation_revoke:${input.missionType}:${now.getTime()}`,
  });
  return record.id;
}

/**
 * The presentation selector read: latest consented, unrevoked adjustment per
 * mission type. Consent revocation takes effect immediately.
 */
export async function loadMissionPresentations(input: {
  tenantId: string;
  canonicalOperatorId: string;
}): Promise<Map<string, Omit<DaphneMissionPresentation, "missionType"> & { declaredAt: Date }>> {
  const out = new Map<string, Omit<DaphneMissionPresentation, "missionType"> & { declaredAt: Date }>();
  const db = await getDb();
  if (!db) return out;
  const allowed = daphneAdaptationAllowed(await loadDaphneMetaPreferences(input));
  if (!allowed) return out;
  const rows = await db
    .select()
    .from(daphneObservations)
    .where(
      and(
        eq(daphneObservations.tenantId, input.tenantId),
        eq(daphneObservations.canonicalOperatorId, input.canonicalOperatorId),
        eq(daphneObservations.sourceType, MISSION_PRESENTATION_SOURCE)
      )
    )
    .orderBy(desc(daphneObservations.occurredAt), desc(daphneObservations.createdAt))
    .limit(200);
  const seen = new Set<string>();
  for (const row of rows) {
    const payload = (row.payloadJson ?? {}) as Record<string, unknown>;
    const missionType = typeof payload.missionType === "string" ? payload.missionType : null;
    if (!missionType || seen.has(missionType)) continue;
    seen.add(missionType);
    const adjustment = payload.revoked === true ? null : parseMissionAdjustment(payload.adjustment);
    if (!adjustment) continue;
    out.set(missionType, {
      adjustment,
      note: describeMissionAdjustment(adjustment),
      sourceObservationId: row.id,
      declaredAt: row.occurredAt,
    });
  }
  return out;
}

/**
 * A consented adjustment applies to matching open work that entered the Day
 * Line after the explanation, and to the explained item itself when it
 * carries forward. Earlier, unexplained items keep their recorded presentation.
 */
export function missionPresentationApplies(
  row: { status: string; createdAt: Date; metadataJson: unknown },
  presentation: { declaredAt: Date }
): boolean {
  if (row.status !== "open") return false;
  if (row.createdAt.getTime() >= presentation.declaredAt.getTime() - 1000) return true;
  return readDayLineOverlay(row.metadataJson).unresolved?.status === "explained";
}

export type CarriedForwardWork = {
  commitmentId: string;
  originalBusinessDate: string;
  title: string;
  objective: string | null;
  missionType: string;
  executionType: "mission" | "challenge" | null;
  presentation: DaphneMissionPresentation | null;
};

/**
 * Resolves Mission Director's selected work back to its canonical Day Line
 * commitment when that commitment is open and dated before the plan date.
 * Read-only: no new commitment is created for carried-forward work.
 */
export async function readCarriedForwardWork(input: {
  tenantId: string;
  canonicalOperatorId: string;
  actorIds: readonly string[];
  businessDate: string;
  sourceRefs: readonly { sourceType: string; sourceId: string }[];
}): Promise<CarriedForwardWork | null> {
  const ref = input.sourceRefs.find(r => r.sourceType === "day_director_commitment");
  if (!ref || !input.actorIds.length) return null;
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(dayDirectorCommitments)
    .where(
      and(
        eq(dayDirectorCommitments.tenantId, input.tenantId),
        eq(dayDirectorCommitments.id, ref.sourceId),
        inArray(dayDirectorCommitments.actorId, [...input.actorIds])
      )
    )
    .limit(1);
  if (!row || row.status !== "open" || row.businessDate >= input.businessDate) return null;
  const meta = (row.metadataJson && typeof row.metadataJson === "object" ? row.metadataJson : {}) as Record<string, unknown>;
  const missionType = commitmentMissionType(row);
  const found = (await loadMissionPresentations(input)).get(missionType);
  return {
    commitmentId: row.id,
    originalBusinessDate: row.businessDate,
    title: row.title,
    objective: row.sourceText,
    missionType,
    executionType: meta.executionType === "mission" || meta.executionType === "challenge" ? meta.executionType : null,
    presentation:
      found && missionPresentationApplies(row, found)
        ? { adjustment: found.adjustment, note: found.note, sourceObservationId: found.sourceObservationId, missionType }
        : null,
  };
}

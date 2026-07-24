import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  commercialMissionIrlStepDetails,
  commercialMissionSteps,
  commercialMissions,
  dayforgeAuditEvents,
  dayforgeEvidenceObjectDeletions,
  dayforgeEvidenceUploads,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { storageDelete, storageGet, storagePut } from "../storage";
import { writeDayforgeEventWith } from "../dayforgeEvents/dayforgeEventStore";
import { DAYFORGE_RETENTION_MATRIX } from "../dayforgeRetention/retentionPolicy";
import type { CommercialMissionTransaction } from "./commercialMissionStore";

export const COMMERCIAL_MISSION_PROOF_MAX_BYTES = 10 * 1024 * 1024;
function evidenceRetentionDays() {
  const policy = DAYFORGE_RETENTION_MATRIX.find(
    entry => entry.resource === "evidence_uploads"
  );
  if (
    !policy ||
    policy.automatedAction !== "delete" ||
    policy.lifetimeDays === null
  ) {
    throw new Error("DayForge evidence retention policy is not configured");
  }
  return policy.lifetimeDays;
}

export const COMMERCIAL_MISSION_PROOF_RETENTION_DAYS = evidenceRetentionDays();
export const COMMERCIAL_MISSION_PROOF_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

const PROOF_RETENTION_MS =
  COMMERCIAL_MISSION_PROOF_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const UPLOAD_GUARD_GRACE_MS = 15 * 60 * 1_000;
const ORPHAN_RETRY_DELAY_MS = 60 * 1_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVIEW_ROLES = new Set<CommercialMissionProofActorRole>([
  "owner",
  "admin",
]);
const SUBMITTABLE_STEP_STATUSES = new Set(["ready", "active"]);

export type CommercialMissionProofMimeType =
  (typeof COMMERCIAL_MISSION_PROOF_MIME_TYPES)[number];
export type CommercialMissionProofActorRole =
  | "owner"
  | "admin"
  | "operator"
  | "field";
export type CommercialMissionProofReviewDecision =
  | "approve"
  | "reject"
  | "override";

type MissionAccessRow = {
  id: number;
  tenantId: string;
  assignedTo: string | null;
};

type MissionStepAccessRow = {
  id: number;
  tenantId: string;
  missionId: number;
  position: number;
  status: "locked" | "ready" | "active" | "completed" | "skipped";
};

type ProofRow = typeof dayforgeEvidenceUploads.$inferSelect;

export type CommercialMissionProofView = {
  id: string;
  missionId: number;
  missionStepId: number;
  submitterId: string;
  mimeType: string;
  sizeBytes: number;
  attemptNumber: number;
  submittedAt: string;
  reviewStatus: ProofRow["reviewStatus"];
  reviewerId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  rejectionReason: string | null;
  previousProofId: string | null;
  assetAvailable: true;
};

export interface CommercialMissionProofVerifier {
  readonly kind: "manual";
  evaluate(input: {
    proofId: string;
    mimeType: CommercialMissionProofMimeType;
    sizeBytes: number;
  }): Promise<{ verdict: "manual_review_required" }>;
}

/**
 * V1 deliberately performs no automated image judgment. The stored asset is
 * pending until an authorized owner or admin records a human decision.
 */
export const manualCommercialMissionProofVerifier: CommercialMissionProofVerifier =
  {
    kind: "manual",
    async evaluate() {
      return { verdict: "manual_review_required" };
    },
  };

function proofView(row: ProofRow): CommercialMissionProofView {
  return {
    id: row.id,
    missionId: row.missionId,
    missionStepId: row.missionStepId,
    submitterId: row.submitterId,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    attemptNumber: row.attemptNumber,
    submittedAt: row.submittedAt.toISOString(),
    reviewStatus: row.reviewStatus,
    reviewerId: row.reviewerId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewNote: row.reviewNote,
    rejectionReason: row.rejectionReason,
    previousProofId: row.previousProofId,
    assetAvailable: true,
  };
}

function proofAuditSnapshot(row: ProofRow) {
  return {
    proofId: row.id,
    missionId: row.missionId,
    missionStepId: row.missionStepId,
    submitterId: row.submitterId,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    attemptNumber: row.attemptNumber,
    submittedAt: row.submittedAt.toISOString(),
    reviewStatus: row.reviewStatus,
    reviewerId: row.reviewerId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewNote: row.reviewNote,
    rejectionReason: row.rejectionReason,
    previousProofId: row.previousProofId,
  };
}

function affectedRows(result: unknown): number {
  return Number(
    (result as { [0]?: { affectedRows?: number } })[0]?.affectedRows ?? 0
  );
}

function assertUuid(label: string, value: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a UUID`);
  }
  return normalized;
}

function normalizedReviewNote(
  decision: CommercialMissionProofReviewDecision,
  note: string | null | undefined
): string | null {
  const normalized = note?.trim() || null;
  if (normalized && normalized.length > 2_000) {
    throw new Error("Proof review note cannot exceed 2000 characters");
  }
  if ((decision === "reject" || decision === "override") && !normalized) {
    throw new Error(
      decision === "reject"
        ? "Rejected proof requires a reason"
        : "Proof override requires an audit reason"
    );
  }
  return normalized;
}

function bytesEqualAt(
  data: Uint8Array,
  offset: number,
  expected: readonly number[]
) {
  return expected.every((value, index) => data[offset + index] === value);
}

function asciiAt(data: Uint8Array, offset: number, length: number) {
  return Buffer.from(data.subarray(offset, offset + length)).toString("ascii");
}

function hasExpectedImageSignature(
  data: Uint8Array,
  mimeType: CommercialMissionProofMimeType
) {
  switch (mimeType) {
    case "image/jpeg":
      return data.length >= 3 && bytesEqualAt(data, 0, [0xff, 0xd8, 0xff]);
    case "image/png":
      return (
        data.length >= 8 &&
        bytesEqualAt(data, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
    case "image/webp":
      return (
        data.length >= 12 &&
        asciiAt(data, 0, 4) === "RIFF" &&
        asciiAt(data, 8, 4) === "WEBP"
      );
    case "image/heic":
    case "image/heif": {
      if (data.length < 12 || asciiAt(data, 4, 4) !== "ftyp") return false;
      return new Set([
        "heic",
        "heix",
        "hevc",
        "hevx",
        "heif",
        "mif1",
        "msf1",
      ]).has(asciiAt(data, 8, 4));
    }
  }
}

export function validateCommercialMissionProofUpload(input: {
  data: Uint8Array;
  mimeType: string;
}): {
  data: Uint8Array;
  mimeType: CommercialMissionProofMimeType;
  sizeBytes: number;
  contentHash: string;
} {
  if (!(input.data instanceof Uint8Array)) {
    throw new Error("Proof upload must be binary data, not a browser data URL");
  }
  const data = Buffer.from(input.data);
  if (data.byteLength === 0) throw new Error("Proof upload is empty");
  if (data.byteLength > COMMERCIAL_MISSION_PROOF_MAX_BYTES) {
    throw new Error(
      `Proof upload exceeds ${COMMERCIAL_MISSION_PROOF_MAX_BYTES} bytes`
    );
  }
  const mimeType = input.mimeType.trim().toLowerCase();
  if (
    !COMMERCIAL_MISSION_PROOF_MIME_TYPES.includes(
      mimeType as CommercialMissionProofMimeType
    )
  ) {
    throw new Error(`Unsupported proof MIME type: ${mimeType || "missing"}`);
  }
  if (
    !hasExpectedImageSignature(data, mimeType as CommercialMissionProofMimeType)
  ) {
    throw new Error(`Proof bytes do not match declared MIME type ${mimeType}`);
  }
  return {
    data,
    mimeType: mimeType as CommercialMissionProofMimeType,
    sizeBytes: data.byteLength,
    contentHash: createHash("sha256").update(data).digest("hex"),
  };
}

export function assertCommercialMissionProofSubmissionAccess(input: {
  tenantId: string;
  missionId: number;
  missionStepId: number;
  actorId: string;
  mission: MissionAccessRow;
  step: MissionStepAccessRow;
}): void {
  assertCommercialMissionProofAssigneeAccess(input);
  if (!SUBMITTABLE_STEP_STATUSES.has(input.step.status)) {
    throw new Error(
      `Mission step cannot accept proof from ${input.step.status}`
    );
  }
}

function assertCommercialMissionProofAssigneeAccess(input: {
  tenantId: string;
  missionId: number;
  missionStepId: number;
  actorId: string;
  mission: MissionAccessRow;
  step: MissionStepAccessRow;
}): void {
  if (
    input.mission.tenantId !== input.tenantId ||
    input.mission.id !== input.missionId ||
    input.step.tenantId !== input.tenantId ||
    input.step.missionId !== input.missionId ||
    input.step.id !== input.missionStepId
  ) {
    throw new Error("Commercial mission proof context not found");
  }
  if (!input.mission.assignedTo || input.mission.assignedTo !== input.actorId) {
    throw new Error("Only the assigned field user can submit mission proof");
  }
}

export function assertCommercialMissionProofReadAccess(input: {
  tenantId: string;
  actorId: string;
  actorRole: CommercialMissionProofActorRole;
  mission: MissionAccessRow;
}): void {
  if (input.mission.tenantId !== input.tenantId) {
    throw new Error("Commercial mission proof context not found");
  }
  if (REVIEW_ROLES.has(input.actorRole)) return;
  if (!input.mission.assignedTo || input.mission.assignedTo !== input.actorId) {
    throw new Error("Commercial mission proof is not available to this user");
  }
}

export function assertCommercialMissionProofReviewAccess(input: {
  tenantId: string;
  actorRole: CommercialMissionProofActorRole;
  proofTenantId: string;
}): void {
  if (input.proofTenantId !== input.tenantId) {
    throw new Error("Commercial mission proof not found");
  }
  if (!REVIEW_ROLES.has(input.actorRole)) {
    throw new Error("Only a tenant owner or admin can review mission proof");
  }
}

export function commercialMissionProofSubmissionPlan(input: {
  latestProof: Pick<ProofRow, "id" | "attemptNumber" | "reviewStatus"> | null;
}): { attemptNumber: number; previousProofId: string | null } {
  if (!input.latestProof) {
    return { attemptNumber: 1, previousProofId: null };
  }
  if (input.latestProof.reviewStatus !== "rejected") {
    throw new Error(
      `Mission proof cannot be resubmitted while the latest attempt is ${input.latestProof.reviewStatus}`
    );
  }
  return {
    attemptNumber: input.latestProof.attemptNumber + 1,
    previousProofId: input.latestProof.id,
  };
}

export function commercialMissionProofReviewStatus(input: {
  currentStatus: ProofRow["reviewStatus"];
  decision: CommercialMissionProofReviewDecision;
}): "approved" | "rejected" | "overridden" {
  if (input.decision === "override") {
    if (input.currentStatus !== "rejected") {
      throw new Error("Only rejected proof can be manually overridden");
    }
    return "overridden";
  }
  if (input.currentStatus !== "pending") {
    throw new Error(`Proof is not reviewable from ${input.currentStatus}`);
  }
  return input.decision === "approve" ? "approved" : "rejected";
}

function extensionForMimeType(mimeType: CommercialMissionProofMimeType) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
  }
}

export function commercialMissionProofStorageKey(input: {
  tenantId: string;
  missionId: number;
  missionStepId: number;
  proofId: string;
  contentHash: string;
  mimeType: CommercialMissionProofMimeType;
}): string {
  const tenantScope = createHash("sha256")
    .update(input.tenantId)
    .digest("hex")
    .slice(0, 24);
  return [
    "dayforge-evidence",
    tenantScope,
    String(input.missionId),
    String(input.missionStepId),
    `${input.proofId}-${input.contentHash.slice(0, 16)}.${extensionForMimeType(input.mimeType)}`,
  ].join("/");
}

type DayforgeDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function storageKeyDigest(storageKey: string) {
  return createHash("sha256").update(storageKey).digest("hex");
}

function safeDeletionError(error: unknown) {
  const errorName =
    error instanceof Error && error.name.trim() ? error.name.trim() : "Error";
  const errorMessage =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Evidence object deletion failed";
  return {
    code: errorName.slice(0, 96),
    message: errorMessage.slice(0, 2_000),
  };
}

async function markProofUploadGuard(input: {
  db: DayforgeDatabase;
  tenantId: string;
  proofId: string;
  requestId: string;
  storageKey: string;
  now: Date;
}) {
  const guardRequestId = `proof-upload-guard:${input.requestId}`;
  const storageKeyHash = storageKeyDigest(input.storageKey);
  await input.db
    .insert(dayforgeEvidenceObjectDeletions)
    .values({
      id: randomUUID(),
      tenantId: input.tenantId,
      evidenceUploadId: input.proofId,
      storageKey: input.storageKey,
      storageKeyHash,
      reason: "upload_guard",
      status: "guarded",
      nextAttemptAt: new Date(input.now.getTime() + UPLOAD_GUARD_GRACE_MS),
      requestId: guardRequestId,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onDuplicateKeyUpdate({ set: { requestId: guardRequestId } });
  const guardRows = await input.db
    .select()
    .from(dayforgeEvidenceObjectDeletions)
    .where(
      and(
        eq(dayforgeEvidenceObjectDeletions.tenantId, input.tenantId),
        eq(dayforgeEvidenceObjectDeletions.requestId, guardRequestId)
      )
    )
    .limit(1);
  const guard = guardRows[0];
  if (
    !guard ||
    guard.evidenceUploadId !== input.proofId ||
    guard.storageKeyHash !== storageKeyHash
  ) {
    throw new Error(
      "Proof upload request ID is already bound to another storage object"
    );
  }
  if (guard.status === "attached") {
    return { id: guard.id, attached: true as const };
  }
  await input.db
    .update(dayforgeEvidenceObjectDeletions)
    .set({
      storageKey: input.storageKey,
      reason: "upload_guard",
      status: "guarded",
      nextAttemptAt: new Date(input.now.getTime() + UPLOAD_GUARD_GRACE_MS),
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(dayforgeEvidenceObjectDeletions.tenantId, input.tenantId),
        eq(dayforgeEvidenceObjectDeletions.id, guard.id)
      )
    );
  return { id: guard.id, attached: false as const };
}

async function cleanupOrQueueProofUploadOrphan(input: {
  db: DayforgeDatabase;
  tenantId: string;
  guardId: string;
  storageKey: string;
}) {
  const startedAt = new Date();
  await input.db
    .update(dayforgeEvidenceObjectDeletions)
    .set({
      reason: "upload_orphan",
      status: "in_progress",
      attemptCount: sql`${dayforgeEvidenceObjectDeletions.attemptCount} + 1`,
      lastAttemptAt: startedAt,
      nextAttemptAt: null,
      updatedAt: startedAt,
    })
    .where(
      and(
        eq(dayforgeEvidenceObjectDeletions.tenantId, input.tenantId),
        eq(dayforgeEvidenceObjectDeletions.id, input.guardId)
      )
    );
  try {
    await storageDelete(input.storageKey);
    const deletedAt = new Date();
    await input.db
      .update(dayforgeEvidenceObjectDeletions)
      .set({
        storageKey: null,
        status: "succeeded",
        deletedAt,
        nextAttemptAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: deletedAt,
      })
      .where(
        and(
          eq(dayforgeEvidenceObjectDeletions.tenantId, input.tenantId),
          eq(dayforgeEvidenceObjectDeletions.id, input.guardId)
        )
      );
  } catch (error) {
    const failure = safeDeletionError(error);
    const failedAt = new Date();
    await input.db
      .update(dayforgeEvidenceObjectDeletions)
      .set({
        status: "retry",
        nextAttemptAt: new Date(failedAt.getTime() + ORPHAN_RETRY_DELAY_MS),
        lastErrorCode: failure.code,
        lastErrorMessage: failure.message,
        updatedAt: failedAt,
      })
      .where(
        and(
          eq(dayforgeEvidenceObjectDeletions.tenantId, input.tenantId),
          eq(dayforgeEvidenceObjectDeletions.id, input.guardId)
        )
      );
  }
}

async function readProofContextWith(
  tx: CommercialMissionTransaction,
  input: { tenantId: string; missionId: number; missionStepId: number }
) {
  const missionRows = await tx
    .select({
      id: commercialMissions.id,
      tenantId: commercialMissions.tenantId,
      assignedTo: commercialMissions.assignedTo,
    })
    .from(commercialMissions)
    .where(
      and(
        eq(commercialMissions.tenantId, input.tenantId),
        eq(commercialMissions.id, input.missionId)
      )
    )
    .limit(1);
  const mission = missionRows[0];
  if (!mission) return null;
  const stepRows = await tx
    .select({
      id: commercialMissionSteps.id,
      tenantId: commercialMissionSteps.tenantId,
      missionId: commercialMissionSteps.missionId,
      position: commercialMissionSteps.position,
      status: commercialMissionSteps.status,
    })
    .from(commercialMissionSteps)
    .where(
      and(
        eq(commercialMissionSteps.tenantId, input.tenantId),
        eq(commercialMissionSteps.missionId, input.missionId),
        eq(commercialMissionSteps.id, input.missionStepId)
      )
    )
    .limit(1)
    .for("update");
  const step = stepRows[0];
  return step ? { mission, step } : null;
}

async function readProofByRequestWith(
  tx: CommercialMissionTransaction,
  input: { tenantId: string; requestId: string }
) {
  const rows = await tx
    .select()
    .from(dayforgeEvidenceUploads)
    .where(
      and(
        eq(dayforgeEvidenceUploads.tenantId, input.tenantId),
        eq(dayforgeEvidenceUploads.requestId, input.requestId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

function assertSubmissionRequestBinding(
  proof: ProofRow,
  input: {
    missionId: number;
    missionStepId: number;
    actorId: string;
    contentHash: string;
    mimeType: CommercialMissionProofMimeType;
    sizeBytes: number;
  }
) {
  if (
    proof.missionId !== input.missionId ||
    proof.missionStepId !== input.missionStepId ||
    proof.submitterId !== input.actorId ||
    proof.contentHash !== input.contentHash ||
    proof.mimeType !== input.mimeType ||
    proof.sizeBytes !== input.sizeBytes
  ) {
    throw new Error(
      "Proof submission request ID is already bound to different content or context"
    );
  }
}

async function prepareSubmissionWith(
  tx: CommercialMissionTransaction,
  input: {
    tenantId: string;
    missionId: number;
    missionStepId: number;
    actorId: string;
    requestId: string;
    contentHash: string;
    mimeType: CommercialMissionProofMimeType;
    sizeBytes: number;
  }
) {
  const context = await readProofContextWith(tx, input);
  if (!context) throw new Error("Commercial mission proof context not found");
  assertCommercialMissionProofAssigneeAccess({ ...input, ...context });
  const replay = await readProofByRequestWith(tx, input);
  if (replay) {
    assertSubmissionRequestBinding(replay, input);
    return { context, replay, plan: null };
  }
  assertCommercialMissionProofSubmissionAccess({ ...input, ...context });
  const latestRows = await tx
    .select()
    .from(dayforgeEvidenceUploads)
    .where(
      and(
        eq(dayforgeEvidenceUploads.tenantId, input.tenantId),
        eq(dayforgeEvidenceUploads.missionId, input.missionId),
        eq(dayforgeEvidenceUploads.missionStepId, input.missionStepId)
      )
    )
    .orderBy(
      desc(dayforgeEvidenceUploads.attemptNumber),
      desc(dayforgeEvidenceUploads.submittedAt)
    )
    .limit(1);
  return {
    context,
    replay: null,
    plan: commercialMissionProofSubmissionPlan({
      latestProof: latestRows[0] ?? null,
    }),
    latestProof: latestRows[0] ?? null,
  };
}

/**
 * Accepts binary image bytes on the server, writes them to access-controlled
 * object storage, and stores only the opaque object key as durable truth.
 * Browser data URLs and client-provided public URLs are never accepted.
 */
export async function submitCommercialMissionProof(input: {
  tenantId: string;
  missionId: number;
  missionStepId: number;
  actorId: string;
  actorRole: CommercialMissionProofActorRole;
  requestId: string;
  data: Uint8Array;
  mimeType: string;
}): Promise<CommercialMissionProofView> {
  const requestId = assertUuid("Proof submission request ID", input.requestId);
  const upload = validateCommercialMissionProofUpload(input);
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const base = {
    tenantId: input.tenantId,
    missionId: input.missionId,
    missionStepId: input.missionStepId,
    actorId: input.actorId,
    requestId,
    contentHash: upload.contentHash,
    mimeType: upload.mimeType,
    sizeBytes: upload.sizeBytes,
  };
  const preflight = await db.transaction(tx => prepareSubmissionWith(tx, base));
  if (preflight.replay) return proofView(preflight.replay);

  // Using the UUID request as the proof UUID makes concurrent retries address
  // the same guarded object instead of creating multiple upload orphans.
  const proofId = requestId;
  const storageKey = commercialMissionProofStorageKey({
    ...base,
    proofId,
  });
  const guard = await markProofUploadGuard({
    db,
    tenantId: input.tenantId,
    proofId,
    requestId,
    storageKey,
    now: new Date(),
  });
  if (guard.attached) {
    const replay = await db.transaction(tx => prepareSubmissionWith(tx, base));
    if (replay.replay) return proofView(replay.replay);
    throw new Error("Proof upload guard is attached but its proof is missing");
  }

  try {
    const stored = await storagePut(storageKey, upload.data, upload.mimeType);
    if (stored.key !== storageKey) {
      throw new Error("Proof storage returned an unexpected object key");
    }
  } catch (error) {
    await cleanupOrQueueProofUploadOrphan({
      db,
      tenantId: input.tenantId,
      guardId: guard.id,
      storageKey,
    }).catch(() => undefined);
    throw error;
  }

  try {
    return await db.transaction(async tx => {
      const prepared = await prepareSubmissionWith(tx, base);
      if (!prepared.plan && !prepared.replay) {
        throw new Error("Proof submission plan is missing");
      }
      const now = new Date();

      if (prepared.replay) {
        await tx
          .update(dayforgeEvidenceObjectDeletions)
          .set({
            reason: "upload_guard",
            status: "attached",
            nextAttemptAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(dayforgeEvidenceObjectDeletions.tenantId, input.tenantId),
              eq(dayforgeEvidenceObjectDeletions.id, guard.id)
            )
          );
        return proofView(prepared.replay);
      }

      const plan = prepared.plan;
      if (!plan) throw new Error("Proof submission plan is missing");
      const purgeAfter = new Date(now.getTime() + PROOF_RETENTION_MS);

      if (prepared.latestProof) {
        const superseded = await tx
          .update(dayforgeEvidenceUploads)
          .set({ reviewStatus: "superseded", updatedAt: now })
          .where(
            and(
              eq(dayforgeEvidenceUploads.tenantId, input.tenantId),
              eq(dayforgeEvidenceUploads.id, prepared.latestProof.id),
              eq(dayforgeEvidenceUploads.reviewStatus, "rejected")
            )
          );
        if (affectedRows(superseded) !== 1) {
          throw new Error("Rejected proof changed before it could be retried");
        }
      }

      await tx
        .insert(dayforgeEvidenceUploads)
        .values({
          id: proofId,
          tenantId: input.tenantId,
          missionId: input.missionId,
          missionStepId: input.missionStepId,
          submitterId: input.actorId,
          storageKey,
          contentHash: upload.contentHash,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          attemptNumber: plan.attemptNumber,
          submittedAt: now,
          reviewStatus: "pending",
          previousProofId: plan.previousProofId,
          requestId,
          purgeAfter,
          createdAt: now,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({ set: { requestId } });

      const persisted = await readProofByRequestWith(tx, {
        tenantId: input.tenantId,
        requestId,
      });
      if (!persisted) throw new Error("Mission proof was not persisted");
      assertSubmissionRequestBinding(persisted, base);

      await tx
        .update(commercialMissionSteps)
        .set({ status: "active", updatedAt: now })
        .where(
          and(
            eq(commercialMissionSteps.tenantId, input.tenantId),
            eq(commercialMissionSteps.missionId, input.missionId),
            eq(commercialMissionSteps.id, input.missionStepId),
            inArray(commercialMissionSteps.status, ["ready", "active"])
          )
        );
      await tx
        .insert(commercialMissionIrlStepDetails)
        .values({
          tenantId: input.tenantId,
          missionId: input.missionId,
          missionStepId: input.missionStepId,
          status: "awaiting_review",
          verificationState: "pending",
          proofAssetId: persisted.id,
          reviewedBy: null,
          reviewedAt: null,
          rejectionReason: null,
        })
        .onDuplicateKeyUpdate({
          set: {
            status: "awaiting_review",
            verificationState: "pending",
            proofAssetId: persisted.id,
            reviewedBy: null,
            reviewedAt: null,
            rejectionReason: null,
            updatedAt: now,
          },
        });
      await tx
        .update(dayforgeEvidenceObjectDeletions)
        .set({
          reason: "upload_guard",
          status: "attached",
          nextAttemptAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(dayforgeEvidenceObjectDeletions.tenantId, input.tenantId),
            eq(dayforgeEvidenceObjectDeletions.id, guard.id)
          )
        );

      const correlationId = `commercial-proof:${persisted.id}:${requestId}`;
      if (prepared.latestProof) {
        await writeDayforgeEventWith(tx, {
          tenantId: input.tenantId,
          actor: { type: input.actorRole, id: input.actorId },
          entityType: "commercial_mission_proof",
          entityId: prepared.latestProof.id,
          eventName: "proof_superseded",
          before: proofAuditSnapshot(prepared.latestProof),
          after: {
            ...proofAuditSnapshot(prepared.latestProof),
            reviewStatus: "superseded",
            supersededByProofId: persisted.id,
          },
          source: "dayforge_field",
          correlationId,
          idempotencyKey: `proof-superseded:${requestId}`,
        });
      }
      await writeDayforgeEventWith(tx, {
        tenantId: input.tenantId,
        actor: { type: input.actorRole, id: input.actorId },
        entityType: "commercial_mission_proof",
        entityId: persisted.id,
        eventName:
          persisted.attemptNumber === 1
            ? "proof_submitted"
            : "proof_resubmitted",
        before: null,
        after: proofAuditSnapshot(persisted),
        source: "dayforge_field",
        correlationId,
        idempotencyKey: `proof-submitted:${requestId}`,
      });
      return proofView(persisted);
    });
  } catch (error) {
    // Commit acknowledgement can be ambiguous. Confirm absence before deleting
    // the object; otherwise the durable guard remains for the retention worker.
    try {
      const committedRows = await db
        .select()
        .from(dayforgeEvidenceUploads)
        .where(
          and(
            eq(dayforgeEvidenceUploads.tenantId, input.tenantId),
            eq(dayforgeEvidenceUploads.requestId, requestId)
          )
        )
        .limit(1);
      const committed = committedRows[0];
      if (committed) {
        assertSubmissionRequestBinding(committed, base);
        await db
          .update(dayforgeEvidenceObjectDeletions)
          .set({
            reason: "upload_guard",
            status: "attached",
            nextAttemptAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(dayforgeEvidenceObjectDeletions.tenantId, input.tenantId),
              eq(dayforgeEvidenceObjectDeletions.id, guard.id)
            )
          );
        return proofView(committed);
      }
    } catch {
      throw error;
    }
    await cleanupOrQueueProofUploadOrphan({
      db,
      tenantId: input.tenantId,
      guardId: guard.id,
      storageKey,
    }).catch(() => undefined);
    throw error;
  }
}

function reviewEventName(decision: CommercialMissionProofReviewDecision) {
  switch (decision) {
    case "approve":
      return "proof_approved";
    case "reject":
      return "proof_rejected";
    case "override":
      return "proof_overridden";
  }
}

export async function reviewCommercialMissionProof(input: {
  tenantId: string;
  proofId: string;
  actorId: string;
  actorRole: CommercialMissionProofActorRole;
  decision: CommercialMissionProofReviewDecision;
  note?: string | null;
  requestId: string;
}): Promise<CommercialMissionProofView> {
  const proofId = assertUuid("Proof ID", input.proofId);
  const requestId = assertUuid("Proof review request ID", input.requestId);
  const reviewNote = normalizedReviewNote(input.decision, input.note);
  assertCommercialMissionProofReviewAccess({
    tenantId: input.tenantId,
    actorRole: input.actorRole,
    proofTenantId: input.tenantId,
  });
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const initialProofRows = await tx
      .select()
      .from(dayforgeEvidenceUploads)
      .where(
        and(
          eq(dayforgeEvidenceUploads.tenantId, input.tenantId),
          eq(dayforgeEvidenceUploads.id, proofId)
        )
      )
      .limit(1);
    const initialProof = initialProofRows[0];
    if (!initialProof) throw new Error("Commercial mission proof not found");
    assertCommercialMissionProofReviewAccess({
      tenantId: input.tenantId,
      actorRole: input.actorRole,
      proofTenantId: initialProof.tenantId,
    });
    const context = await readProofContextWith(tx, {
      tenantId: input.tenantId,
      missionId: initialProof.missionId,
      missionStepId: initialProof.missionStepId,
    });
    if (!context) throw new Error("Commercial mission proof context not found");
    const lockedProofRows = await tx
      .select()
      .from(dayforgeEvidenceUploads)
      .where(
        and(
          eq(dayforgeEvidenceUploads.tenantId, input.tenantId),
          eq(dayforgeEvidenceUploads.id, proofId),
          eq(dayforgeEvidenceUploads.missionId, initialProof.missionId),
          eq(dayforgeEvidenceUploads.missionStepId, initialProof.missionStepId)
        )
      )
      .limit(1)
      .for("update");
    const proof = lockedProofRows[0];
    if (!proof) throw new Error("Commercial mission proof context changed");

    const eventName = reviewEventName(input.decision);
    const eventIdempotencyKey = `proof-review:${requestId}`;
    const priorEvents = await tx
      .select({
        entityId: dayforgeAuditEvents.entityId,
        eventName: dayforgeAuditEvents.eventName,
      })
      .from(dayforgeAuditEvents)
      .where(
        and(
          eq(dayforgeAuditEvents.scopeKey, `tenant:${input.tenantId}`),
          eq(dayforgeAuditEvents.idempotencyKey, eventIdempotencyKey)
        )
      )
      .limit(1);
    if (priorEvents[0]) {
      if (
        priorEvents[0].entityId !== proof.id ||
        priorEvents[0].eventName !== eventName
      ) {
        throw new Error(
          "Proof review request ID is already bound to another decision"
        );
      }
      return proofView(proof);
    }

    const nextStatus = commercialMissionProofReviewStatus({
      currentStatus: proof.reviewStatus,
      decision: input.decision,
    });
    const now = new Date();
    const update = await tx
      .update(dayforgeEvidenceUploads)
      .set({
        reviewStatus: nextStatus,
        reviewerId: input.actorId,
        reviewedAt: now,
        reviewNote,
        rejectionReason:
          input.decision === "reject" ? reviewNote : proof.rejectionReason,
        updatedAt: now,
      })
      .where(
        and(
          eq(dayforgeEvidenceUploads.tenantId, input.tenantId),
          eq(dayforgeEvidenceUploads.id, proof.id),
          eq(dayforgeEvidenceUploads.reviewStatus, proof.reviewStatus)
        )
      );
    if (affectedRows(update) !== 1) {
      throw new Error("Mission proof review lost a concurrency race");
    }

    const accepted = nextStatus === "approved" || nextStatus === "overridden";
    await tx
      .insert(commercialMissionIrlStepDetails)
      .values({
        tenantId: input.tenantId,
        missionId: proof.missionId,
        missionStepId: proof.missionStepId,
        status: accepted ? "completed" : "rejected",
        verificationState: nextStatus,
        proofAssetId: proof.id,
        reviewedBy: input.actorId,
        reviewedAt: now,
        rejectionReason: input.decision === "reject" ? reviewNote : null,
      })
      .onDuplicateKeyUpdate({
        set: {
          status: accepted ? "completed" : "rejected",
          verificationState: nextStatus,
          proofAssetId: proof.id,
          reviewedBy: input.actorId,
          reviewedAt: now,
          rejectionReason: input.decision === "reject" ? reviewNote : null,
          updatedAt: now,
        },
      });

    let unlockedStepId: number | null = null;
    if (accepted) {
      const completed = await tx
        .update(commercialMissionSteps)
        .set({ status: "completed", completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commercialMissionSteps.tenantId, input.tenantId),
            eq(commercialMissionSteps.missionId, proof.missionId),
            eq(commercialMissionSteps.id, proof.missionStepId),
            inArray(commercialMissionSteps.status, ["ready", "active"])
          )
        );
      if (affectedRows(completed) !== 1) {
        throw new Error("Mission proof step is no longer reviewable");
      }
      const nextSteps = await tx
        .select({
          id: commercialMissionSteps.id,
          status: commercialMissionSteps.status,
        })
        .from(commercialMissionSteps)
        .where(
          and(
            eq(commercialMissionSteps.tenantId, input.tenantId),
            eq(commercialMissionSteps.missionId, proof.missionId),
            gt(commercialMissionSteps.position, context.step.position),
            inArray(commercialMissionSteps.status, [
              "locked",
              "ready",
              "active",
            ])
          )
        )
        .orderBy(asc(commercialMissionSteps.position))
        .limit(1)
        .for("update");
      const nextStep = nextSteps[0];
      if (nextStep?.status === "locked") {
        await tx
          .update(commercialMissionSteps)
          .set({ status: "ready", updatedAt: now })
          .where(
            and(
              eq(commercialMissionSteps.tenantId, input.tenantId),
              eq(commercialMissionSteps.missionId, proof.missionId),
              eq(commercialMissionSteps.id, nextStep.id),
              eq(commercialMissionSteps.status, "locked")
            )
          );
        await tx
          .insert(commercialMissionIrlStepDetails)
          .values({
            tenantId: input.tenantId,
            missionId: proof.missionId,
            missionStepId: nextStep.id,
            status: "ready",
          })
          .onDuplicateKeyUpdate({
            set: { status: "ready", updatedAt: now },
          });
        unlockedStepId = nextStep.id;
      }
    }

    const persistedRows = await tx
      .select()
      .from(dayforgeEvidenceUploads)
      .where(
        and(
          eq(dayforgeEvidenceUploads.tenantId, input.tenantId),
          eq(dayforgeEvidenceUploads.id, proof.id)
        )
      )
      .limit(1);
    const persisted = persistedRows[0];
    if (!persisted) throw new Error("Reviewed mission proof is missing");
    await writeDayforgeEventWith(tx, {
      tenantId: input.tenantId,
      actor: { type: input.actorRole, id: input.actorId },
      entityType: "commercial_mission_proof",
      entityId: proof.id,
      eventName,
      before: proofAuditSnapshot(proof),
      after: {
        ...proofAuditSnapshot(persisted),
        unlockedStepId,
      },
      source: "dayforge_field",
      correlationId: `commercial-proof:${proof.id}`,
      idempotencyKey: eventIdempotencyKey,
    });
    return proofView(persisted);
  });
}

export async function listCommercialMissionProofs(input: {
  tenantId: string;
  missionId: number;
  actorId: string;
  actorRole: CommercialMissionProofActorRole;
}): Promise<CommercialMissionProofView[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const missionRows = await db
    .select({
      id: commercialMissions.id,
      tenantId: commercialMissions.tenantId,
      assignedTo: commercialMissions.assignedTo,
    })
    .from(commercialMissions)
    .where(
      and(
        eq(commercialMissions.tenantId, input.tenantId),
        eq(commercialMissions.id, input.missionId)
      )
    )
    .limit(1);
  const mission = missionRows[0];
  if (!mission) throw new Error("Commercial mission not found");
  assertCommercialMissionProofReadAccess({ ...input, mission });
  const rows = await db
    .select()
    .from(dayforgeEvidenceUploads)
    .where(
      and(
        eq(dayforgeEvidenceUploads.tenantId, input.tenantId),
        eq(dayforgeEvidenceUploads.missionId, input.missionId)
      )
    )
    .orderBy(
      asc(dayforgeEvidenceUploads.missionStepId),
      desc(dayforgeEvidenceUploads.attemptNumber)
    );
  return rows.map(proofView);
}

/** Returns a short-lived private download URL only after tenant and role checks. */
export async function getCommercialMissionProofAsset(input: {
  tenantId: string;
  proofId: string;
  actorId: string;
  actorRole: CommercialMissionProofActorRole;
}) {
  const proofId = assertUuid("Proof ID", input.proofId);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const proofRows = await db
    .select()
    .from(dayforgeEvidenceUploads)
    .where(
      and(
        eq(dayforgeEvidenceUploads.tenantId, input.tenantId),
        eq(dayforgeEvidenceUploads.id, proofId)
      )
    )
    .limit(1);
  const proof = proofRows[0];
  if (!proof) throw new Error("Commercial mission proof not found");
  const missionRows = await db
    .select({
      id: commercialMissions.id,
      tenantId: commercialMissions.tenantId,
      assignedTo: commercialMissions.assignedTo,
    })
    .from(commercialMissions)
    .where(
      and(
        eq(commercialMissions.tenantId, input.tenantId),
        eq(commercialMissions.id, proof.missionId)
      )
    )
    .limit(1);
  const mission = missionRows[0];
  if (!mission) throw new Error("Commercial mission proof context not found");
  assertCommercialMissionProofReadAccess({ ...input, mission });
  const asset = await storageGet(proof.storageKey);
  return {
    proofId: proof.id,
    mimeType: proof.mimeType,
    sizeBytes: proof.sizeBytes,
    url: asset.url,
  };
}

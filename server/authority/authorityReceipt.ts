import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { authorityReceipts } from "../../drizzle/schema";
import { getDb } from "../db";

export const AUTHORITY_CLAIM_TYPES = [
  "payment_verified",
  "account_won",
  "message_sent",
  "action_completed",
  "field_observation_attested",
] as const;

export type AuthorityClaimType = (typeof AUTHORITY_CLAIM_TYPES)[number];
export type AuthorityEvidenceClass =
  | "authoritative_external"
  | "operator_attested";
export type AuthorityVerificationClass = "VERIFIED" | "ATTESTED";

export type AuthorityReceipt = {
  id: string;
  tenantId: string;
  claimType: AuthorityClaimType;
  subjectType: string;
  subjectId: string;
  sourceType: string;
  sourceRef: string;
  actorType: string;
  actorId: string | null;
  evidenceClass: AuthorityEvidenceClass;
  verificationClass: AuthorityVerificationClass;
  admissionPolicy: string;
  occurredAt: string | null;
  admittedAt: string;
  metadata: Record<string, unknown> | null;
  idempotencyKey: string;
};

export type AdmitAuthorityClaimInput = {
  tenantId: string;
  claimType: AuthorityClaimType;
  subjectType: string;
  subjectId: string;
  sourceType: string;
  sourceRef: string;
  actorType: string;
  actorId?: string | null;
  evidenceClass: AuthorityEvidenceClass;
  verificationClass: AuthorityVerificationClass;
  admissionPolicy: string;
  occurredAt?: Date | string | null;
  metadata?: Record<string, unknown> | null;
};

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type AuthorityTransaction =
  Parameters<Parameters<Db["transaction"]>[0]>[0];

function required(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Authority receipt requires ${label}`);
  if (normalized.length > max)
    throw new Error(`Authority receipt ${label} exceeds ${max} characters`);
  return normalized;
}

function parsedOccurredAt(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new Error("Authority receipt occurredAt is invalid");
  return parsed;
}

export function assertAuthorityClaimPolicy(
  input: AdmitAuthorityClaimInput
): void {
  required(input.tenantId, "tenantId", 64);
  required(input.subjectType, "subjectType", 64);
  required(input.subjectId, "subjectId", 191);
  required(input.sourceType, "sourceType", 64);
  required(input.sourceRef, "sourceRef", 191);
  required(input.actorType, "actorType", 32);
  required(input.admissionPolicy, "admissionPolicy", 96);

  if (input.claimType === "payment_verified") {
    if (
      input.evidenceClass !== "authoritative_external" ||
      input.verificationClass !== "VERIFIED"
    )
      throw new Error(
        "payment_verified requires authoritative_external VERIFIED evidence"
      );
    if (
      input.sourceType !== "stripe_payment_intent" &&
      input.sourceType !== "cleancloud_paid_order"
    )
      throw new Error(
        "payment_verified requires a supported payment source"
      );
  }

  if (input.claimType === "message_sent") {
    if (
      input.evidenceClass !== "authoritative_external" ||
      input.verificationClass !== "VERIFIED" ||
      input.sourceType !== "twilio_message"
    )
      throw new Error(
        "message_sent requires VERIFIED Twilio provider evidence"
      );
  }

  if (input.claimType === "action_completed") {
    const attested =
      input.evidenceClass === "operator_attested" &&
      input.verificationClass === "ATTESTED" &&
      input.sourceType === "commercial_mission_event" &&
      ["operator", "driver", "human", "voice"].includes(input.actorType);
    if (!attested)
      throw new Error(
        "action_completed requires an explicit human-attested commercial mission event"
      );
  }

  if (input.claimType === "field_observation_attested") {
    const attested =
      input.evidenceClass === "operator_attested" &&
      input.verificationClass === "ATTESTED" &&
      input.sourceType === "commercial_mission_event" &&
      ["operator", "driver", "human", "voice"].includes(input.actorType);
    if (!attested)
      throw new Error(
        "field_observation_attested requires explicit human testimony from a persisted commercial mission event"
      );
  }

  if (input.claimType === "account_won") {
    const external =
      input.evidenceClass === "authoritative_external" &&
      input.verificationClass === "VERIFIED";
    const attested =
      input.evidenceClass === "operator_attested" &&
      input.verificationClass === "ATTESTED" &&
      ["operator", "driver", "human", "voice"].includes(input.actorType);
    if (!external && !attested)
      throw new Error(
        "account_won requires VERIFIED external evidence or an explicit operator attestation"
      );
  }

  parsedOccurredAt(input.occurredAt);
}

export function authorityReceiptIdempotencyKey(
  input: Pick<
    AdmitAuthorityClaimInput,
    "claimType" | "subjectType" | "subjectId" | "sourceType" | "sourceRef"
  >
): string {
  const digest = createHash("sha256")
    .update(
      [
        input.claimType,
        input.subjectType.trim(),
        input.subjectId.trim(),
        input.sourceType.trim(),
        input.sourceRef.trim(),
      ].join("\u0000")
    )
    .digest("hex");
  return `authority:${input.claimType}:${digest}`;
}

function toReceipt(
  row: typeof authorityReceipts.$inferSelect
): AuthorityReceipt {
  return {
    id: row.id,
    tenantId: row.tenantId,
    claimType: row.claimType,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
    actorType: row.actorType,
    actorId: row.actorId,
    evidenceClass: row.evidenceClass,
    verificationClass: row.verificationClass,
    admissionPolicy: row.admissionPolicy,
    occurredAt: row.occurredAt?.toISOString() ?? null,
    admittedAt: row.admittedAt.toISOString(),
    metadata:
      row.metadataJson && typeof row.metadataJson === "object"
        ? (row.metadataJson as Record<string, unknown>)
        : null,
    idempotencyKey: row.idempotencyKey,
  };
}

export async function admitAuthorityClaimWith(
  tx: AuthorityTransaction,
  input: AdmitAuthorityClaimInput
): Promise<AuthorityReceipt> {
  assertAuthorityClaimPolicy(input);
  const key = authorityReceiptIdempotencyKey(input);
  const id =
    "auth-" +
    createHash("sha256")
      .update(`${input.tenantId.trim()}\u0000${key}`)
      .digest("hex")
      .slice(0, 40);

  await tx
    .insert(authorityReceipts)
    .values({
      id,
      tenantId: input.tenantId.trim(),
      claimType: input.claimType,
      subjectType: input.subjectType.trim(),
      subjectId: input.subjectId.trim(),
      sourceType: input.sourceType.trim(),
      sourceRef: input.sourceRef.trim(),
      actorType: input.actorType.trim(),
      actorId: input.actorId?.trim() || null,
      evidenceClass: input.evidenceClass,
      verificationClass: input.verificationClass,
      admissionPolicy: input.admissionPolicy.trim(),
      occurredAt: parsedOccurredAt(input.occurredAt),
      metadataJson: input.metadata ?? null,
      idempotencyKey: key,
    })
    .onDuplicateKeyUpdate({ set: { idempotencyKey: key } });

  const [row] = await tx
    .select()
    .from(authorityReceipts)
    .where(
      and(
        eq(authorityReceipts.tenantId, input.tenantId.trim()),
        eq(authorityReceipts.idempotencyKey, key)
      )
    )
    .limit(1);
  if (!row) throw new Error("Authority receipt did not persist");
  return toReceipt(row);
}

export async function getAuthorityReceiptByIdWith(
  tx: AuthorityTransaction,
  input: { tenantId: string; receiptId: string }
): Promise<AuthorityReceipt | null> {
  const [row] = await tx
    .select()
    .from(authorityReceipts)
    .where(
      and(
        eq(authorityReceipts.tenantId, input.tenantId),
        eq(authorityReceipts.id, input.receiptId)
      )
    )
    .limit(1);
  return row ? toReceipt(row) : null;
}

export async function findAuthorityReceiptForSubjectWith(
  tx: AuthorityTransaction,
  input: {
    tenantId: string;
    claimType: AuthorityClaimType;
    subjectType: string;
    subjectId: string;
  }
): Promise<AuthorityReceipt | null> {
  const [row] = await tx
    .select()
    .from(authorityReceipts)
    .where(
      and(
        eq(authorityReceipts.tenantId, input.tenantId),
        eq(authorityReceipts.claimType, input.claimType),
        eq(authorityReceipts.subjectType, input.subjectType),
        eq(authorityReceipts.subjectId, input.subjectId)
      )
    )
    .orderBy(desc(authorityReceipts.admittedAt))
    .limit(1);
  return row ? toReceipt(row) : null;
}


export async function findAuthorityReceiptForSubject(input: {
  tenantId: string;
  claimType: AuthorityClaimType;
  subjectType: string;
  subjectId: string;
}): Promise<AuthorityReceipt | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return findAuthorityReceiptForSubjectWith(
    db as unknown as AuthorityTransaction,
    input
  );
}

export async function getAuthorityReceiptById(input: {
  tenantId: string;
  receiptId: string;
}): Promise<AuthorityReceipt | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return getAuthorityReceiptByIdWith(
    db as unknown as AuthorityTransaction,
    input
  );
}

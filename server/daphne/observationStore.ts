import { createHash } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import { daphneObservations } from "../../drizzle/schema";
import { getDb } from "../db";
import { recordDaphneMetricEvent } from "./metrics";

export const DAPHNE_OBSERVATION_KINDS = [
  "user_statement",
  "agent_message",
  "user_action",
  "agent_action",
  "tool_event",
  "correction",
  "preference_declaration",
  "verified_operational_outcome",
  "verified_business_outcome",
  "relationship_event",
  "system_context_event",
] as const;

export type DaphneObservationKind = (typeof DAPHNE_OBSERVATION_KINDS)[number];

export const DAPHNE_EVIDENCE_CHANNELS = [
  "stated",
  "revealed",
  "system_record",
  "authoritative_external",
] as const;

export type DaphneEvidenceChannel = (typeof DAPHNE_EVIDENCE_CHANNELS)[number];

export const DAPHNE_VERIFICATION_STATUSES = [
  "unverified",
  "attested",
  "verified",
  "rejected",
  "disputed",
] as const;

export type DaphneVerificationStatus =
  (typeof DAPHNE_VERIFICATION_STATUSES)[number];

export type DaphneObservationRecord = {
  id: string;
  tenantId: string;
  canonicalOperatorId: string;
  operatorUserId: string | null;
  sessionId: string | null;
  actorType: "user" | "agent" | "system" | "tool" | "external";
  actorId: string | null;
  agentId: string | null;
  observationKind: DaphneObservationKind;
  evidenceChannel: DaphneEvidenceChannel;
  verificationStatus: DaphneVerificationStatus;
  sourceType: string;
  sourceReference: string;
  occurredAt: string;
  context: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  idempotencyKey: string;
  createdAt: string;
};

export type RecordDaphneObservationInput = {
  tenantId: string;
  canonicalOperatorId: string;
  operatorUserId?: string | null;
  sessionId?: string | null;
  actorType: DaphneObservationRecord["actorType"];
  actorId?: string | null;
  agentId?: string | null;
  observationKind: DaphneObservationKind;
  evidenceChannel: DaphneEvidenceChannel;
  verificationStatus?: DaphneVerificationStatus;
  sourceType: string;
  sourceReference: string;
  occurredAt: string | Date;
  context?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  idempotencyKey: string;
};

function required(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Daphne observation requires ${label}`);
  if (normalized.length > max) {
    throw new Error(`Daphne observation ${label} exceeds ${max} characters`);
  }
  return normalized;
}

function optional(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > max) {
    throw new Error(`Daphne observation optional value exceeds ${max} characters`);
  }
  return normalized;
}

function date(value: string | Date): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Daphne observation occurredAt must be a valid date");
  }
  return parsed;
}

export function daphneObservationId(input: {
  tenantId: string;
  canonicalOperatorId: string;
  idempotencyKey: string;
}): string {
  const material = [
    required(input.tenantId, "tenantId", 64),
    required(input.canonicalOperatorId, "canonicalOperatorId", 191),
    required(input.idempotencyKey, "idempotencyKey", 191),
  ].join("\u0000");
  return `dobs_${createHash("sha256").update(material).digest("hex").slice(0, 48)}`;
}

export function normalizeDaphneObservationInput(input: RecordDaphneObservationInput) {
  const tenantId = required(input.tenantId, "tenantId", 64);
  const canonicalOperatorId = required(
    input.canonicalOperatorId,
    "canonicalOperatorId",
    191
  );
  const idempotencyKey = required(input.idempotencyKey, "idempotencyKey", 191);
  const sourceType = required(input.sourceType, "sourceType", 64);
  const sourceReference = required(input.sourceReference, "sourceReference", 191);

  return {
    id: daphneObservationId({ tenantId, canonicalOperatorId, idempotencyKey }),
    tenantId,
    canonicalOperatorId,
    operatorUserId: optional(input.operatorUserId, 128),
    sessionId: optional(input.sessionId, 191),
    actorType: input.actorType,
    actorId: optional(input.actorId, 191),
    agentId: optional(input.agentId, 128),
    observationKind: input.observationKind,
    evidenceChannel: input.evidenceChannel,
    verificationStatus: input.verificationStatus ?? "unverified",
    sourceType,
    sourceReference,
    occurredAt: date(input.occurredAt),
    contextJson: input.context ?? null,
    payloadJson: input.payload ?? null,
    metadataJson: input.metadata ?? null,
    idempotencyKey,
  } as const;
}

function toRecord(row: typeof daphneObservations.$inferSelect): DaphneObservationRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    canonicalOperatorId: row.canonicalOperatorId,
    operatorUserId: row.operatorUserId,
    sessionId: row.sessionId,
    actorType: row.actorType,
    actorId: row.actorId,
    agentId: row.agentId,
    observationKind: row.observationKind,
    evidenceChannel: row.evidenceChannel,
    verificationStatus: row.verificationStatus,
    sourceType: row.sourceType,
    sourceReference: row.sourceReference,
    occurredAt: row.occurredAt.toISOString(),
    context: (row.contextJson as Record<string, unknown> | null) ?? null,
    payload: (row.payloadJson as Record<string, unknown> | null) ?? null,
    metadata: (row.metadataJson as Record<string, unknown> | null) ?? null,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Append-only/idempotent write. Existing rows are deliberately not updated.
 * A changed fact or correction must be written as a new observation with its
 * own idempotency key so the historical evidence remains intact.
 */
export async function recordDaphneObservation(
  input: RecordDaphneObservationInput
): Promise<DaphneObservationRecord> {
  const normalized = normalizeDaphneObservationInput(input);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  await db
    .insert(daphneObservations)
    .values(normalized)
    .onDuplicateKeyUpdate({ set: { id: normalized.id } });

  const [row] = await db
    .select()
    .from(daphneObservations)
    .where(
      and(
        eq(daphneObservations.tenantId, normalized.tenantId),
        eq(daphneObservations.canonicalOperatorId, normalized.canonicalOperatorId),
        eq(daphneObservations.idempotencyKey, normalized.idempotencyKey)
      )
    )
    .limit(1);

  if (!row) throw new Error("Daphne observation did not persist");
  await recordDaphneMetricEvent({
    tenantId,
    canonicalOperatorId,
    agentId: normalized.agentId,
    eventName: "observation_ingested",
    properties: { observationKind: normalized.observationKind, evidenceChannel: normalized.evidenceChannel },
    sourceReference: normalized.sourceReference,
    occurredAt: normalized.occurredAt,
    idempotencyKey: `observation:${row.id}`,
  }).catch(() => undefined);
  return toRecord(row);
}

export async function listDaphneObservations(input: {
  tenantId: string;
  canonicalOperatorId: string;
  sessionId?: string;
  before?: Date;
  limit?: number;
}): Promise<DaphneObservationRecord[]> {
  const tenantId = required(input.tenantId, "tenantId", 64);
  const canonicalOperatorId = required(
    input.canonicalOperatorId,
    "canonicalOperatorId",
    191
  );
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const predicates = [
    eq(daphneObservations.tenantId, tenantId),
    eq(daphneObservations.canonicalOperatorId, canonicalOperatorId),
  ];
  if (input.sessionId?.trim()) {
    predicates.push(eq(daphneObservations.sessionId, input.sessionId.trim()));
  }
  if (input.before) {
    predicates.push(lt(daphneObservations.occurredAt, input.before));
  }

  const rows = await db
    .select()
    .from(daphneObservations)
    .where(and(...predicates))
    .orderBy(desc(daphneObservations.occurredAt), desc(daphneObservations.createdAt))
    .limit(Math.max(1, Math.min(input.limit ?? 100, 500)));

  return rows.map(toRecord);
}

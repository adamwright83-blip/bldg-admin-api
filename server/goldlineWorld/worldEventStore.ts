import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import {
  goldlineEventReceipts,
  goldlineWorldEvents,
} from "../../drizzle/schema";
import type { GoldlineWorldEvent } from "../../shared/goldlineWorld";
import { classificationIsTruthful } from "../../shared/goldlineWorld";
import { getDb } from "../db";

export type AppendGoldlineWorldEvent = Omit<GoldlineWorldEvent, "id"> & {
  id?: string;
};

function toEvent(
  row: typeof goldlineWorldEvents.$inferSelect
): GoldlineWorldEvent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    physicalEntityId: row.physicalEntityId,
    eventType: row.eventType,
    classification: row.classification,
    actorType: row.actorType,
    actorId: row.actorId,
    occurredAt: row.occurredAt.toISOString(),
    observedAt: row.observedAt?.toISOString() ?? null,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceEvidenceReference: row.sourceEvidenceReference,
    provenanceClass: row.provenanceClass,
    verificationClass: row.verificationClass,
    confidence: row.confidence,
    idempotencyKey: row.idempotencyKey,
    correlationId: row.correlationId,
    metadata: (row.metadataJson ?? {}) as Record<string, unknown>,
  };
}

export async function appendGoldlineWorldEvent(
  input: AppendGoldlineWorldEvent
): Promise<GoldlineWorldEvent> {
  if (!classificationIsTruthful(input))
    throw new Error(`Goldline event ${input.eventType} cannot be classified as ${input.classification}`);
  if (input.provenanceClass === "generated_game_fiction" && input.classification !== "game_projection")
    throw new Error("Generated game fiction cannot be persisted as business evidence, action, or outcome");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const id = input.id ?? randomUUID();
  await db.insert(goldlineWorldEvents).values({
    id,
    tenantId: input.tenantId,
    physicalEntityId: input.physicalEntityId,
    eventType: input.eventType,
    classification: input.classification,
    actorType: input.actorType,
    actorId: input.actorId,
    occurredAt: new Date(input.occurredAt),
    observedAt: input.observedAt ? new Date(input.observedAt) : null,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceEvidenceReference: input.sourceEvidenceReference,
    provenanceClass: input.provenanceClass,
    verificationClass: input.verificationClass,
    confidence: input.confidence,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    metadataJson: input.metadata,
  }).onDuplicateKeyUpdate({ set: { idempotencyKey: input.idempotencyKey } });
  const [stored] = await db.select().from(goldlineWorldEvents).where(and(
    eq(goldlineWorldEvents.tenantId, input.tenantId),
    eq(goldlineWorldEvents.idempotencyKey, input.idempotencyKey)
  )).limit(1);
  if (!stored) throw new Error("Goldline world event was not persisted");
  return toEvent(stored);
}

export async function listEntityChronicle(input: {
  tenantId: string;
  physicalEntityId: string;
  limit?: number;
}): Promise<GoldlineWorldEvent[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(goldlineWorldEvents).where(and(
    eq(goldlineWorldEvents.tenantId, input.tenantId),
    eq(goldlineWorldEvents.physicalEntityId, input.physicalEntityId)
  )).orderBy(desc(goldlineWorldEvents.occurredAt), desc(goldlineWorldEvents.createdAt)).limit(input.limit ?? 100);
  return rows.map(toEvent);
}

export async function listUnpresentedCelebrationEvents(input: {
  tenantId: string;
  viewerId: string;
  limit?: number;
}): Promise<GoldlineWorldEvent[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const receipts = await db.select({ worldEventId: goldlineEventReceipts.worldEventId })
    .from(goldlineEventReceipts)
    .where(and(
      eq(goldlineEventReceipts.tenantId, input.tenantId),
      eq(goldlineEventReceipts.viewerId, input.viewerId),
      eq(goldlineEventReceipts.receiptType, "presented")
    ));
  const seen = receipts.map(receipt => receipt.worldEventId);
  const where = seen.length
    ? and(
        eq(goldlineWorldEvents.tenantId, input.tenantId),
        inArray(goldlineWorldEvents.classification, ["action", "outcome", "game_projection"]),
        notInArray(goldlineWorldEvents.id, seen)
      )
    : and(
        eq(goldlineWorldEvents.tenantId, input.tenantId),
        inArray(goldlineWorldEvents.classification, ["action", "outcome", "game_projection"])
      );
  const rows = await db.select().from(goldlineWorldEvents).where(where)
    .orderBy(goldlineWorldEvents.occurredAt, goldlineWorldEvents.createdAt)
    .limit(input.limit ?? 20);
  return rows.map(toEvent);
}

export async function recordGoldlineEventReceipt(input: {
  tenantId: string;
  viewerId: string;
  worldEventId: string;
  receiptType: "presented" | "read" | "acknowledged";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(goldlineEventReceipts).values({ id: randomUUID(), ...input })
    .onDuplicateKeyUpdate({ set: { receiptType: input.receiptType } });
  return { ok: true };
}

import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, like, notInArray } from "drizzle-orm";
import {
  goldlineEventReceipts,
  goldlineWorldEvents,
  physicalEntityBindings,
} from "../../drizzle/schema";
import type { GoldlineWorldEvent } from "../../shared/goldlineWorld";
import { classificationIsTruthful } from "../../shared/goldlineWorld";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import { latestEconomicSnapshots } from "../../shared/goldlineEconomicProjection";
import { getAuthorityReceiptById } from "../platform/authority/authorityReceipt";

/** Include unresolved bindings: a paid order is real without a guessed place. */
export async function listCurrentEconomicReceipts(tenantId: string) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(goldlineWorldEvents).where(and(
    eq(goldlineWorldEvents.tenantId, tenantId), eq(goldlineWorldEvents.sourceType, "gumball")
  ));
  return latestEconomicSnapshots(rows.map(toEvent)).sort((a, b) =>
    (b.observedAt ?? b.occurredAt).localeCompare(a.observedAt ?? a.occurredAt) || b.id.localeCompare(a.id)).slice(0, 20);
}

export type AppendGoldlineWorldEvent = Omit<GoldlineWorldEvent, "id"> & {
  id?: string;
};

/** Matches `goldline_world_events.idempotencyKey` varchar(191). */
export const GOLDLINE_WORLD_EVENT_IDEMPOTENCY_MAX = 191;

export function fitGoldlineWorldEventIdempotencyKey(key: string): string {
  if (key.length <= GOLDLINE_WORLD_EVENT_IDEMPOTENCY_MAX) return key;
  return `gl-ev:${createHash("sha256").update(key).digest("hex")}`;
}

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

  if (input.eventType === "account_won") {
    const receiptId =
      typeof input.metadata?.authorityReceiptId === "string"
        ? input.metadata.authorityReceiptId.trim()
        : "";
    const missionValue = input.metadata?.commercialMissionId;
    const commercialMissionId =
      typeof missionValue === "number" && Number.isInteger(missionValue) && missionValue > 0
        ? String(missionValue)
        : typeof missionValue === "string" && /^\d+$/.test(missionValue.trim())
          ? String(Number(missionValue.trim()))
          : "";
    if (!receiptId)
      throw new Error("Goldline account_won requires an authority receipt");
    if (!commercialMissionId)
      throw new Error("Goldline account_won requires a commercial mission binding");
    const receipt = await getAuthorityReceiptById({
      tenantId: input.tenantId,
      receiptId,
    });
    if (
      !receipt ||
      receipt.claimType !== "account_won" ||
      receipt.subjectType !== "commercial_mission" ||
      receipt.subjectId !== commercialMissionId ||
      receipt.sourceRef !== input.sourceEvidenceReference ||
      receipt.verificationClass !== input.verificationClass
    )
      throw new Error(
        "Goldline account_won authority receipt does not match the event evidence or mission"
      );

    if (input.physicalEntityId) {
      const accountId =
        typeof receipt.metadata?.accountId === "number" ||
        typeof receipt.metadata?.accountId === "string"
          ? String(receipt.metadata.accountId).trim()
          : "";
      if (!accountId)
        throw new Error(
          "Goldline account_won authority receipt lacks its commercial account binding"
        );
      const bindingRows = await db
        .select({ physicalEntityId: physicalEntityBindings.physicalEntityId })
        .from(physicalEntityBindings)
        .where(
          and(
            eq(physicalEntityBindings.tenantId, input.tenantId),
            eq(physicalEntityBindings.bindingType, "commercial_account"),
            eq(physicalEntityBindings.bindingKey, accountId),
            eq(physicalEntityBindings.reviewState, "accepted")
          )
        )
        .limit(2);
      const boundIds = new Set(bindingRows.map(row => row.physicalEntityId));
      if (boundIds.size !== 1 || !boundIds.has(input.physicalEntityId))
        throw new Error(
          "Goldline account_won physical entity does not match the admitted commercial account"
        );
    }
  }

  const id = input.id ?? randomUUID();
  const idempotencyKey = fitGoldlineWorldEventIdempotencyKey(input.idempotencyKey);
  try {
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
    idempotencyKey,
    correlationId: input.correlationId,
    metadataJson: input.metadata,
  }).onDuplicateKeyUpdate({ set: { idempotencyKey } });
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
  }
  const [stored] = await db.select().from(goldlineWorldEvents).where(and(
    eq(goldlineWorldEvents.tenantId, input.tenantId),
    eq(goldlineWorldEvents.idempotencyKey, idempotencyKey)
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

/** Every recovery-intervention event at or after `since`, oldest first. */
export async function listRecoveryChronicleSince(input: {
  tenantId: string;
  since: string;
  limit?: number;
}): Promise<GoldlineWorldEvent[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(goldlineWorldEvents).where(and(
    eq(goldlineWorldEvents.tenantId, input.tenantId),
    like(goldlineWorldEvents.correlationId, "recovery-intervention:%"),
    gte(goldlineWorldEvents.occurredAt, new Date(input.since))
  )).orderBy(asc(goldlineWorldEvents.occurredAt), asc(goldlineWorldEvents.createdAt)).limit(input.limit ?? 2000);
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

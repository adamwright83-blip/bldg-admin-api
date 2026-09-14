import { and, desc, eq } from "drizzle-orm";
import { claireRelationshipEvents } from "../../../drizzle/schema";
import { getDb } from "../../db";
import type {
  CharacterId,
  ClaireRelationshipEvent,
  ClaireRelationshipEventInput,
} from "./types";

function toRecord(
  row: typeof claireRelationshipEvents.$inferSelect
): ClaireRelationshipEvent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorUserId: row.operatorUserId,
    characterId: row.characterId as CharacterId,
    eventType: row.eventType as ClaireRelationshipEvent["eventType"],
    summary: row.summary,
    provenance: row.provenance,
    relatedEntityType: row.relatedEntityType ?? null,
    relatedEntityId: row.relatedEntityId ?? null,
    evidenceSource: row.evidenceSource ?? null,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Append-only write. There is no update/delete for relationship events —
 * durable memory is only durable if it can't be quietly edited after the
 * fact. Identity must already be resolved by the caller (operatorUserId is
 * required, not derived here); see types.ts for the fail-closed contract.
 */
export async function appendClaireRelationshipEvent(
  input: ClaireRelationshipEventInput
): Promise<ClaireRelationshipEvent | null> {
  const db = await getDb();
  if (!db) return null;
  const occurredAt = input.occurredAt ?? new Date();
  const [result] = await db.insert(claireRelationshipEvents).values({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    characterId: input.characterId ?? "claire",
    eventType: input.eventType,
    summary: input.summary,
    provenance: input.provenance,
    relatedEntityType: input.relatedEntityType ?? null,
    relatedEntityId: input.relatedEntityId ?? null,
    evidenceSource: input.evidenceSource ?? null,
    occurredAt,
  });
  const insertedId = (result as { insertId?: number }).insertId;
  if (!insertedId) return null;
  const [row] = await db
    .select()
    .from(claireRelationshipEvents)
    .where(eq(claireRelationshipEvents.id, insertedId))
    .limit(1);
  return row ? toRecord(row) : null;
}

/**
 * Bounded, operator-scoped retrieval — never an unrestricted dump of
 * everything an operator has ever said (Slice 4). `limit` defaults to a
 * small number of recent events; callers doing tier computation should
 * pass a much larger bound (or omit it) since tier math needs the full
 * history, while prompt-time "shared history" retrieval should stay small.
 */
export async function listClaireRelationshipEvents(input: {
  tenantId: string;
  operatorUserId: string;
  characterId?: CharacterId;
  limit?: number;
}): Promise<ClaireRelationshipEvent[]> {
  const db = await getDb();
  if (!db) return [];
  const query = db
    .select()
    .from(claireRelationshipEvents)
    .where(
      and(
        eq(claireRelationshipEvents.tenantId, input.tenantId),
        eq(claireRelationshipEvents.operatorUserId, input.operatorUserId),
        eq(claireRelationshipEvents.characterId, input.characterId ?? "claire")
      )
    )
    .orderBy(desc(claireRelationshipEvents.occurredAt));
  const rows = input.limit ? await query.limit(input.limit) : await query;
  return rows.map(toRecord).reverse();
}

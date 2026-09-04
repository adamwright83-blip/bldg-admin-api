import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { json, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { operationsEvents, orders } from "../../drizzle/schema";
import type { TowerWarsAttackEvent, TowerWarsBuildingId } from "../../shared/towerWars";
import { impactForAttack, repairImpacts, type TowerImpact } from "../../shared/towerWarsImpacts";
import { getDb } from "../db";

export const towerImpacts = mysqlTable("goldline_tower_impacts", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  payload: json("payload").$type<TowerImpact>().notNull(),
});

/** Only canonical server compilation calls this, never a replay reducer.
 * Upsert preserves a single record per attack; geometry derives from identity. */
export async function persistCanonicalImpacts(tenantId: string, attacks: readonly TowerWarsAttackEvent[]) {
  const db = await getDb();
  if (!db) return [];
  const evidence = await db.select({ orderId: orders.id, status: orders.status,
    buildingSlug: operationsEvents.buildingSlug, occurredAt: operationsEvents.actualEventTimestamp })
    .from(operationsEvents).innerJoin(orders, and(eq(orders.id, operationsEvents.orderId), eq(orders.tenantId, tenantId)))
    .where(and(eq(operationsEvents.tenantId, tenantId), eq(operationsEvents.sourceEventType, "pickup_completed"), eq(operationsEvents.eventStatus, "completed")));
  const repairs = evidence.flatMap(row => {
    const buildingId: TowerWarsBuildingId | null = row.buildingSlug === "opusla" ? "opus_la" : row.buildingSlug === "centuryparkeast" ? "century_park_east" : null;
    return buildingId ? [{ orderId: String(row.orderId), buildingId, collectedAt: row.occurredAt.toISOString(), valid: ["collected", "processing", "ready", "delivered"].includes(row.status) }] : [];
  });
  const impacts = repairImpacts(attacks.map(a => impactForAttack(a)), repairs);
  for (const payload of impacts) {
    const id = createHash("sha256").update(JSON.stringify([tenantId, payload.attackId])).digest("hex");
    await db.insert(towerImpacts).values({ id, tenantId, payload }).onDuplicateKeyUpdate({ set: { payload } });
  }
  return impacts;
}

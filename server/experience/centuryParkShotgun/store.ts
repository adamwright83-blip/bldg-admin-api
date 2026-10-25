import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { scheduledOutreachMessages } from "../../../drizzle/schema";
import { centuryParkShots as shots, type ShotRow } from "./schema";

async function database() {
  const db = await getDb();
  if (!db)
    throw new Error(
      "The shotgun ledger requires durable database storage. No action was scheduled."
    );
  return db;
}
export const outboxKey = (shot: Pick<ShotRow, "id">) => `cpe_shot_${shot.id}`;

export const shotgunStore = {
  async byRequest(tenantId: string, requestId: string) {
    const db = await database();
    const [row] = await db
      .select()
      .from(shots)
      .where(and(eq(shots.tenantId, tenantId), eq(shots.requestId, requestId)))
      .limit(1);
    return row ?? null;
  },
  async reserve(row: ShotRow) {
    const db = await database();
    // Two unique constraints arbitrate concurrent tabs/devices. Never overwrite an approved payload.
    await db
      .insert(shots)
      .values(row)
      .onDuplicateKeyUpdate({ set: { id: sql`${shots.id}` } });
    const byRequest = await this.byRequest(row.tenantId, row.requestId);
    if (byRequest) return byRequest;
    const [existing] = await db
      .select()
      .from(shots)
      .where(
        and(
          eq(shots.tenantId, row.tenantId),
          eq(shots.customerId, row.customerId),
          eq(shots.opportunityKey, row.opportunityKey)
        )
      )
      .limit(1);
    if (!existing) throw new Error("Shot reservation could not be read back.");
    return existing;
  },
  async update(
    row: ShotRow,
    patch: Partial<Pick<ShotRow, "state" | "messageId" | "failureReason">>
  ) {
    const db = await database();
    await db
      .update(shots)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(shots.tenantId, row.tenantId), eq(shots.id, row.id)));
  },
  async recordFailure(row: ShotRow) {
    const db = await database();
    // A late failing request must not overwrite another device's successful acknowledgment.
    await db
      .update(shots)
      .set({
        state: "retryable_failure",
        failureReason:
          "Scheduling or approval could not be confirmed. Retry this saved action.",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(shots.tenantId, row.tenantId),
          eq(shots.id, row.id),
          isNull(shots.messageId)
        )
      );
  },
  async list(tenantId: string) {
    const db = await database();
    return db
      .select()
      .from(shots)
      .where(eq(shots.tenantId, tenantId))
      .orderBy(desc(shots.approvedAt));
  },
  async outbox(row: ShotRow) {
    const db = await database();
    const [message] = await db
      .select()
      .from(scheduledOutreachMessages)
      .where(
        and(
          eq(scheduledOutreachMessages.tenantId, row.tenantId),
          eq(scheduledOutreachMessages.operatorId, row.operatorId),
          eq(scheduledOutreachMessages.customerId, row.customerId),
          eq(scheduledOutreachMessages.idempotencyKey, outboxKey(row))
        )
      )
      .limit(1);
    return message ?? null;
  },
};
export type ShotgunStore = typeof shotgunStore;

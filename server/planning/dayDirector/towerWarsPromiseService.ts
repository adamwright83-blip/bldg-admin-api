/** Permission-backed real commitments. Never creates revenue or game attacks. */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { dayDirectorCommitments, towerWarsPromises } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { getBusinessDayWindow } from "../../dashboardZoned";
import { canExecuteTowerWarsPromise, type TowerWarsBuildingId, type TowerWarsPromiseType, type TowerWarsPermissionStatus, type TowerWarsPermissionChannel } from "../../../shared/towerWars";

export async function listTowerWarsPromises(tenantId: string) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(towerWarsPromises)
    .where(eq(towerWarsPromises.tenantId, tenantId));
  return rows.map(row => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    fulfilledAt: row.fulfilledAt?.toISOString() ?? null,
  }));
}

export async function recordTowerWarsPromise(input: {
  tenantId: string;
  buildingId: TowerWarsBuildingId;
  customerIdentity?: string | null;
  promiseType: TowerWarsPromiseType;
  sourceText: string;
  quantity?: number | null;
  permissionStatus: TowerWarsPermissionStatus;
  permissionChannel: TowerWarsPermissionChannel;
  permissionEvidence?: string | null;
  sourceReference: string;
  idempotencyKey: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (
    input.permissionStatus === "recorded" &&
    !input.permissionEvidence?.trim()
  )
    throw new Error(
      "Recorded permission requires explicit permission evidence"
    );
  await db
    .insert(towerWarsPromises)
    .values({ id: randomUUID(), ...input })
    .onDuplicateKeyUpdate({ set: { sourceText: input.sourceText } });
  const [row] = await db
    .select()
    .from(towerWarsPromises)
    .where(
      and(
        eq(towerWarsPromises.tenantId, input.tenantId),
        eq(towerWarsPromises.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);
  return row;
}

export async function activateTowerWarsPromise(input: {
  tenantId: string;
  promiseId: string;
  actorId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [promise] = await db
    .select()
    .from(towerWarsPromises)
    .where(
      and(
        eq(towerWarsPromises.tenantId, input.tenantId),
        eq(towerWarsPromises.id, input.promiseId)
      )
    )
    .limit(1);
  if (!promise) throw new Error("Promise not found");
  if (!canExecuteTowerWarsPromise(promise))
    throw new Error("Promise lacks explicit execution permission evidence");
  const bounds = getBusinessDayWindow();
  const idempotencyKey = `tower-wars:${promise.id}`;
  const title = (
    {
      offer_insert: "Fulfill promised offer inserts",
      referral_card: "Fulfill permission-backed referral action",
      loyalty_reward: "Fulfill configured loyalty action",
      thank_you_presentation: "Upgrade promised presentation",
      other: "Fulfill permission-backed promise",
    } as const
  )[promise.promiseType];
  await db
    .insert(dayDirectorCommitments)
    .values({
      id: randomUUID(),
      tenantId: input.tenantId,
      actorId: input.actorId,
      businessDate: bounds.businessDate,
      idempotencyKey,
      title,
      kind: "growth",
      quantity: promise.quantity,
      provenance: "user_reported",
      sourceText: promise.sourceText,
      metadataJson: {
        towerWarsPromiseId: promise.id,
        buildingId: promise.buildingId,
        sourceReference: promise.sourceReference,
        permissionEvidence: promise.permissionEvidence,
      },
    })
    .onDuplicateKeyUpdate({ set: { title } });
  return {
    ok: true as const,
    businessDate: bounds.businessDate,
    createdRevenue: false as const,
    attackCreated: false as const,
  };
}

export async function fulfillTowerWarsPromise(input: {
  tenantId: string;
  promiseId: string;
  actorId: string;
  fulfillmentEvidence: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .select()
    .from(towerWarsPromises)
    .where(
      and(
        eq(towerWarsPromises.tenantId, input.tenantId),
        eq(towerWarsPromises.id, input.promiseId)
      )
    )
    .limit(1);
  if (!row) throw new Error("Promise not found");
  if (!row.fulfilledAt)
    await db
      .update(towerWarsPromises)
      .set({
        fulfilledAt: new Date(),
        fulfilledBy: input.actorId,
        fulfillmentEvidence: input.fulfillmentEvidence,
      })
      .where(
        and(
          eq(towerWarsPromises.tenantId, input.tenantId),
          eq(towerWarsPromises.id, input.promiseId),
          isNull(towerWarsPromises.fulfilledAt)
        )
      );
  return {
    ok: true as const,
    alreadyFulfilled: Boolean(row.fulfilledAt),
    createdRevenue: false as const,
  };
}

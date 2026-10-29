import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../../../db";
import { externalOperationalOrders } from "../../../../drizzle/schema";
import { browserSyncBindings } from "../browserSync/schema";
import { driverPickups, pickupConnections } from "./schema";
import {
  pickupCountsSchema,
  type CleancloudPickupRow,
  type PickupBridgeView,
} from "../../../../shared/cleancloudPickup";

export type PickupActor = { tenantId: string; actorId: string };
export type PickupSource = { bindingId: string; storeLabel: string };
export type PickupSnapshot = PickupSource & {
  observedAt: string;
  rows: CleancloudPickupRow[];
};
async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Database unavailable.",
    });
  return db;
}
export async function pickupConnection(actor: PickupActor) {
  const db = await database();
  const [binding] = await db
    .select()
    .from(browserSyncBindings)
    .where(eq(browserSyncBindings.tenantId, actor.tenantId));
  const [connection] = await db
    .select()
    .from(pickupConnections)
    .where(eq(pickupConnections.tenantId, actor.tenantId));
  return { binding: binding ?? null, connection: connection ?? null };
}
async function requireSource(
  actor: PickupActor,
  source: PickupSource,
  requireEnabled = true
) {
  const current = await pickupConnection(actor);
  if (
    !current.binding ||
    current.binding.id !== source.bindingId ||
    current.binding.storeLabel !== source.storeLabel
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "CleanCloud store differs from the paired account. Reconnect Gumball.",
    });
  }
  if (
    requireEnabled &&
    (!current.connection?.enabled ||
      current.connection.bindingId !== source.bindingId ||
      current.connection.actorId !== actor.actorId)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Pickup connection changed or paused. Reconnect Gumball.",
    });
  }
  return current;
}
export async function connectPickups(
  actor: PickupActor,
  snapshot: PickupSnapshot & { excludedOrderIds: string[] }
) {
  await requireSource(actor, snapshot, false);
  const db = await database();
  await db
    .insert(pickupConnections)
    .values({
      tenantId: actor.tenantId,
      bindingId: snapshot.bindingId,
      actorId: actor.actorId,
      enabled: true,
      excludedOrderIds: snapshot.excludedOrderIds,
    })
    .onDuplicateKeyUpdate({
      set: {
        bindingId: snapshot.bindingId,
        actorId: actor.actorId,
        enabled: true,
        excludedOrderIds: snapshot.excludedOrderIds,
        lastError: null,
      },
    });
  return capturePickups(actor, snapshot);
}
export async function capturePickups(
  actor: PickupActor,
  snapshot: PickupSnapshot
) {
  await requireSource(actor, snapshot);
  const observedAt = new Date(snapshot.observedAt);
  if (
    !Number.isFinite(observedAt.getTime()) ||
    Math.abs(Date.now() - observedAt.getTime()) > 5 * 60_000
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Pickup observation is stale. Read CleanCloud again.",
    });
  const ids = snapshot.rows.map(row => row.externalOrderId);
  if (new Set(ids).size !== ids.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Duplicate source order IDs. Pickup capture stopped.",
    });
  const db = await database();
  return db.transaction(async tx => {
    // Serialize snapshots, holds and pickup commands on the tenant connection.
    const [locked] = await tx
      .select()
      .from(pickupConnections)
      .where(eq(pickupConnections.tenantId, actor.tenantId))
      .for("update");
    if (
      !locked?.enabled ||
      locked.bindingId !== snapshot.bindingId ||
      locked.actorId !== actor.actorId
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Pickup connection changed.",
      });
    // Captures can arrive out of order. A snapshot observed before the one already
    // applied is superseded: applying it would re-add or remove pickups based on an
    // older view of CleanCloud than the Driver already shows.
    if (locked.capturedAt && observedAt.getTime() < locked.capturedAt.getTime())
      return {
        imported: 0,
        removed: 0,
        excluded: 0,
        superseded: true,
        capturedAt: locked.capturedAt.toISOString(),
      };
    const excluded = new Set(locked.excludedOrderIds);
    let imported = 0;
    for (const row of snapshot.rows) {
      const [existing] = await tx
        .select()
        .from(driverPickups)
        .where(
          and(
            eq(driverPickups.tenantId, actor.tenantId),
            eq(driverPickups.bindingId, snapshot.bindingId),
            eq(driverPickups.externalOrderId, row.externalOrderId)
          )
        )
        .for("update");
      if (excluded.has(row.externalOrderId)) {
        if (existing && !existing.collectedAt) {
          await tx
            .update(driverPickups)
            .set({ state: "held" })
            .where(eq(driverPickups.id, existing.id));
          await tx
            .update(externalOperationalOrders)
            .set({ reviewState: "discarded" })
            .where(
              and(
                eq(
                  externalOperationalOrders.id,
                  existing.externalOperationalOrderId
                ),
                eq(externalOperationalOrders.tenantId, actor.tenantId)
              )
            );
        }
        continue;
      }
      if (existing?.collectedAt) continue;
      const id = existing?.externalOperationalOrderId ?? randomUUID();
      const operational = {
        customerName: row.customerName,
        address: row.address,
        scheduledDate: row.scheduledDate,
        windowStart: row.windowStart,
        windowEnd: row.windowEnd,
        notes: row.notes,
        reviewState: "confirmed" as const,
      };
      if (!existing) {
        await tx.insert(externalOperationalOrders).values({
          id,
          tenantId: actor.tenantId,
          sourceSystem: "cleancloud",
          ingestionMethod: "browser",
          externalOrderId: row.externalOrderId,
          jobKind: "pickup",
          ...operational,
          confirmedAt: new Date(),
        });
        await tx.insert(driverPickups).values({
          id: randomUUID(),
          tenantId: actor.tenantId,
          bindingId: snapshot.bindingId,
          externalOrderId: row.externalOrderId,
          externalOperationalOrderId: id,
          sourceJson: row,
          state: "ready",
          observedAt,
        });
      } else {
        await tx
          .update(externalOperationalOrders)
          .set(operational)
          .where(
            and(
              eq(externalOperationalOrders.id, id),
              eq(externalOperationalOrders.tenantId, actor.tenantId)
            )
          );
        await tx
          .update(driverPickups)
          .set({ sourceJson: row, observedAt, state: "ready", lastError: null })
          .where(eq(driverPickups.id, existing.id));
      }
      imported++;
    }
    // The snapshot is CleanCloud's complete awaiting-pickup list (the bridge checks its
    // row count against CleanCloud's own counter). An uncollected pickup that is no
    // longer in it was cancelled, rescheduled out, or collected elsewhere, so it leaves
    // the Driver instead of lingering as a stop that does not exist.
    const present = new Set(ids);
    const open = await tx
      .select({
        id: driverPickups.id,
        externalOrderId: driverPickups.externalOrderId,
        externalOperationalOrderId: driverPickups.externalOperationalOrderId,
        state: driverPickups.state,
      })
      .from(driverPickups)
      .where(
        and(
          eq(driverPickups.tenantId, actor.tenantId),
          eq(driverPickups.bindingId, snapshot.bindingId),
          isNull(driverPickups.collectedAt)
        )
      )
      .for("update");
    const vanished = open.filter(
      row => !present.has(row.externalOrderId) && row.state !== "held"
    );
    for (const row of vanished) {
      await tx
        .update(driverPickups)
        .set({ state: "held", lastError: "No longer in CleanCloud's pickup list." })
        .where(eq(driverPickups.id, row.id));
      await tx
        .update(externalOperationalOrders)
        .set({ reviewState: "discarded" })
        .where(
          and(
            eq(externalOperationalOrders.id, row.externalOperationalOrderId),
            eq(externalOperationalOrders.tenantId, actor.tenantId)
          )
        );
    }
    await tx
      .update(pickupConnections)
      .set({ capturedAt: observedAt, lastError: null })
      .where(eq(pickupConnections.tenantId, actor.tenantId));
    return {
      imported,
      removed: vanished.length,
      superseded: false,
      excluded: snapshot.rows.filter(row => excluded.has(row.externalOrderId))
        .length,
      capturedAt: observedAt.toISOString(),
    };
  });
}
export async function recordPickup(
  actor: PickupActor,
  input: { id: string; bagCount: number; garmentCount: number }
) {
  const counts = pickupCountsSchema.parse({
    bagCount: input.bagCount,
    garmentCount: input.garmentCount,
  });
  const db = await database();
  return db.transaction(async tx => {
    const [connection] = await tx
      .select()
      .from(pickupConnections)
      .where(eq(pickupConnections.tenantId, actor.tenantId))
      .for("update");
    const [pickup] = await tx
      .select()
      .from(driverPickups)
      .where(
        and(
          eq(driverPickups.tenantId, actor.tenantId),
          eq(driverPickups.externalOperationalOrderId, input.id)
        )
      )
      .for("update");
    if (
      !pickup ||
      !connection?.enabled ||
      connection.bindingId !== pickup.bindingId ||
      connection.excludedOrderIds.includes(pickup.externalOrderId) ||
      pickup.state === "held"
    )
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This pickup is unavailable or on hold.",
      });
    if (pickup.collectedAt) {
      if (
        pickup.bagCount !== counts.bagCount ||
        pickup.garmentCount !== counts.garmentCount
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "This pickup is already recorded with different counts.",
        });
      return { success: true, state: pickup.state, alreadyRecorded: true };
    }
    const now = new Date();
    await tx
      .update(driverPickups)
      .set({
        ...counts,
        state: "pending",
        collectedBy: actor.actorId,
        collectedAt: now,
        lastError: null,
      })
      .where(eq(driverPickups.id, pickup.id));
    await tx
      .update(externalOperationalOrders)
      .set({
        operationalStatus: "completed",
        completedAt: now,
        reconciliationStatus: "update_required",
        reconciledAt: null,
        externalLastVerifiedAt: null,
      })
      .where(
        and(
          eq(externalOperationalOrders.id, input.id),
          eq(externalOperationalOrders.tenantId, actor.tenantId)
        )
      );
    return { success: true, state: "pending" as const, alreadyRecorded: false };
  });
}
export async function claimPickup(actor: PickupActor, source: PickupSource) {
  await requireSource(actor, source);
  const db = await database();
  return db.transaction(async tx => {
    const [connection] = await tx
      .select()
      .from(pickupConnections)
      .where(eq(pickupConnections.tenantId, actor.tenantId))
      .for("update");
    if (
      !connection?.enabled ||
      connection.bindingId !== source.bindingId ||
      connection.actorId !== actor.actorId
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Pickup connection changed.",
      });
    const [pickup] = await tx
      .select()
      .from(driverPickups)
      .where(
        and(
          eq(driverPickups.tenantId, actor.tenantId),
          eq(driverPickups.bindingId, source.bindingId),
          or(
            eq(driverPickups.state, "pending"),
            and(
              eq(driverPickups.state, "working"),
              lt(driverPickups.leaseUntil, new Date())
            )
          )
        )
      )
      .limit(1)
      .for("update");
    if (!pickup) return null;
    if (connection.excludedOrderIds.includes(pickup.externalOrderId))
      throw new TRPCError({ code: "CONFLICT", message: "Pickup is on hold." });
    const leaseToken = randomUUID();
    const leaseUntil = new Date(Date.now() + 120_000);
    await tx
      .update(driverPickups)
      .set({
        state: "working",
        leaseToken,
        leaseUntil,
      })
      .where(eq(driverPickups.id, pickup.id));
    return {
      id: pickup.id,
      leaseToken,
      leaseUntil: leaseUntil.toISOString(),
      bindingId: source.bindingId,
      storeLabel: source.storeLabel,
      ...pickup.sourceJson,
    };
  });
}
export async function renewPickupLease(
  actor: PickupActor,
  input: PickupSource & { id: string; leaseToken: string }
) {
  await requireSource(actor, input);
  const db = await database();
  return db.transaction(async tx => {
    const [connection] = await tx
      .select()
      .from(pickupConnections)
      .where(eq(pickupConnections.tenantId, actor.tenantId))
      .for("update");
    const [pickup] = await tx
      .select()
      .from(driverPickups)
      .where(
        and(
          eq(driverPickups.tenantId, actor.tenantId),
          eq(driverPickups.id, input.id),
          eq(driverPickups.bindingId, input.bindingId)
        )
      )
      .for("update");
    if (
      !connection?.enabled ||
      connection.actorId !== actor.actorId ||
      connection.bindingId !== input.bindingId ||
      !pickup ||
      pickup.state !== "working" ||
      pickup.leaseToken !== input.leaseToken ||
      !pickup.leaseUntil ||
      pickup.leaseUntil.getTime() <= Date.now() ||
      connection.excludedOrderIds.includes(pickup.externalOrderId)
    )
      return null;
    const leaseUntil = new Date(Date.now() + 120_000);
    await tx
      .update(driverPickups)
      .set({ leaseUntil })
      .where(eq(driverPickups.id, pickup.id));
    return { leaseUntil: leaseUntil.toISOString() };
  });
}
export async function finishPickup(
  actor: PickupActor,
  input: PickupSource & {
    id: string;
    leaseToken: string;
    verified: boolean;
    externalOrderId: string;
    customerName: string;
    detailRowId: string | null;
    observedAt: string;
    error?: string;
  }
) {
  await requireSource(actor, input);
  const db = await database();
  return db.transaction(async tx => {
    const [pickup] = await tx
      .select()
      .from(driverPickups)
      .where(
        and(
          eq(driverPickups.id, input.id),
          eq(driverPickups.tenantId, actor.tenantId),
          eq(driverPickups.bindingId, input.bindingId)
        )
      )
      .for("update");
    if (!pickup || pickup.leaseToken !== input.leaseToken)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Pickup receipt is stale or belongs to another command.",
      });
    if (pickup.state === "synced") return { state: "synced" as const };
    if (pickup.state !== "working")
      throw new TRPCError({
        code: "CONFLICT",
        message: "Pickup command is not active.",
      });
    const observedAt = new Date(input.observedAt);
    const valid =
      input.verified &&
      input.externalOrderId === pickup.externalOrderId &&
      input.customerName === pickup.sourceJson.customerName &&
      input.detailRowId === `det_${pickup.externalOrderId}` &&
      Number.isFinite(observedAt.getTime()) &&
      Math.abs(Date.now() - observedAt.getTime()) < 120_000;
    if (input.verified && !valid)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Receipt does not verify this exact order in Detail.",
      });
    const state = valid ? ("synced" as const) : ("attention" as const);
    await tx
      .update(driverPickups)
      .set({
        state,
        leaseUntil: null,
        verifiedAt: valid ? observedAt : null,
        lastError: valid
          ? null
          : (input.error ?? "CleanCloud update could not be verified.").slice(
              0,
              512
            ),
      })
      .where(eq(driverPickups.id, pickup.id));
    if (valid)
      await tx
        .update(externalOperationalOrders)
        .set({
          reconciliationStatus: "reconciled",
          reconciledAt: observedAt,
          externalLastVerifiedAt: observedAt,
        })
        .where(
          and(
            eq(externalOperationalOrders.id, pickup.externalOperationalOrderId),
            eq(externalOperationalOrders.tenantId, actor.tenantId)
          )
        );
    return { state };
  });
}
export async function retryPickup(actor: PickupActor, id: string) {
  const db = await database();
  const [connection] = await db
    .select()
    .from(pickupConnections)
    .where(eq(pickupConnections.tenantId, actor.tenantId));
  const [pickup] = await db
    .select()
    .from(driverPickups)
    .where(
      and(
        eq(driverPickups.tenantId, actor.tenantId),
        eq(driverPickups.externalOperationalOrderId, id)
      )
    );
  if (
    !pickup ||
    !connection?.enabled ||
    connection.bindingId !== pickup.bindingId ||
    connection.excludedOrderIds.includes(pickup.externalOrderId)
  )
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Pickup is unavailable.",
    });
  if (pickup.state === "attention")
    await db
      .update(driverPickups)
      .set({ state: "pending", lastError: null })
      .where(
        and(
          eq(driverPickups.id, pickup.id),
          eq(driverPickups.state, "attention")
        )
      );
  return { success: true };
}
export async function pickupViews(tenantId: string, ids: string[]) {
  const result = new Map<string, PickupBridgeView>();
  if (!ids.length) return result;
  const db = await database();
  const rows = await db
    .select()
    .from(driverPickups)
    .where(
      and(
        eq(driverPickups.tenantId, tenantId),
        inArray(driverPickups.externalOperationalOrderId, ids)
      )
    );
  for (const row of rows)
    result.set(row.externalOperationalOrderId, {
      state: row.state,
      bagCount: row.bagCount,
      garmentCount: row.garmentCount,
      observedAt: row.observedAt.toISOString(),
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      error: row.lastError,
    });
  return result;
}

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { orders, type User } from "../drizzle/schema";
import { getDb } from "./db";

/**
 * Coverage gap closed: `orders.updateStatus` (the exact canonical mutation
 * the in-game PICKUP/DELIVERY action surface reuses via
 * `GoldlineActionServices.resolveOrder`) had no integration coverage of its
 * transition/idempotency/payment-gate behavior before this file — only
 * `orders.create` was tested. This proves the real authoritative rules the
 * Goldline gameplay layer now depends on, not a duplicate of them.
 */
function createDriverContext(): TrpcContext {
  const user: User = {
    id: 1,
    tenantId: "default",
    openId: `driver-${randomUUID().slice(0, 8)}`,
    name: "Fixture Driver",
    email: null,
    loginMethod: "password",
    role: "driver",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    vendorSession: null,
    tenantId: "default",
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

async function createFixtureOrder(overrides: {
  pickupDate?: string;
  deliveryDate?: string;
}) {
  const ctx = createDriverContext();
  const caller = appRouter.createCaller(ctx);
  const { orderId } = await caller.orders.create({
    serviceType: "wash_fold",
    pickupDate: overrides.pickupDate ?? "2026-08-13",
    pickupTimeWindow: "9:00am – 11:00am",
    address: "500 Status Transition Ave, Los Angeles, CA",
    firstName: "Status",
    lastName: "Transition",
    phone: "(310) 555-0199",
  });
  return orderId;
}

describe("orders.updateStatus — canonical pickup/delivery transition", () => {
  it("genuine pickup: new -> collected, then idempotently no-ops on replay", async () => {
    const orderId = await createFixtureOrder({});
    const ctx = createDriverContext();
    const caller = appRouter.createCaller(ctx);

    const first = await caller.admin.updateStatus({
      orderId,
      status: "collected",
    });
    expect(first).toMatchObject({ success: true, alreadyCompleted: false });

    const order = await caller.admin.getOrder({ id: orderId });
    expect(order?.status).toBe("collected");

    // B. ALREADY RESOLVED — a second request against the same order must
    // not duplicate business truth; it reconciles to the same authoritative
    // state without a second side-effecting write.
    const replay = await caller.admin.updateStatus({
      orderId,
      status: "collected",
    });
    expect(replay).toMatchObject({ success: true, alreadyCompleted: true });

    const afterReplay = await caller.admin.getOrder({ id: orderId });
    expect(afterReplay?.status).toBe("collected");
  });

  it("E. PAYMENT-BLOCKED DELIVERY: an unpaid order cannot be authoritatively delivered through the canonical mutation", async () => {
    const orderId = await createFixtureOrder({});
    const ctx = createDriverContext();
    const caller = appRouter.createCaller(ctx);

    await caller.admin.updateStatus({ orderId, status: "collected" });
    await caller.admin.updateStatus({ orderId, status: "processing" });
    await caller.admin.updateStatus({ orderId, status: "ready" });

    const order = await caller.admin.getOrder({ id: orderId });
    expect(order?.paid).toBe(false);

    await expect(
      caller.admin.updateStatus({ orderId, status: "delivered" })
    ).rejects.toThrow(/charge the order/i);

    // The real business rule held — status genuinely never advanced.
    const afterAttempt = await caller.admin.getOrder({ id: orderId });
    expect(afterAttempt?.status).toBe("ready");
  });

  it("D. GENUINE PAID/ELIGIBLE DELIVERY: a paid order transitions ready -> delivered", async () => {
    const orderId = await createFixtureOrder({});
    const ctx = createDriverContext();
    const caller = appRouter.createCaller(ctx);

    await caller.admin.updateStatus({ orderId, status: "collected" });
    await caller.admin.updateStatus({ orderId, status: "processing" });
    await caller.admin.updateStatus({ orderId, status: "ready" });

    // Reaching a genuinely paid order requires a real Stripe charge, which
    // this fixture has no live payment method for — set the same `paid`
    // flag the real charge webhook/flow sets, to reach the state under
    // test without fabricating a second payment-truth mechanism.
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db
      .update(orders)
      .set({ paid: true, paidAt: new Date() })
      .where(eq(orders.id, orderId));

    const result = await caller.admin.updateStatus({
      orderId,
      status: "delivered",
    });
    expect(result).toMatchObject({ success: true });

    const order = await caller.admin.getOrder({ id: orderId });
    expect(order?.status).toBe("delivered");

    // F. STALE / ALREADY DELIVERED — calling delivered again on an
    // already-delivered order must not throw or corrupt state; it stays
    // truthfully delivered (the real client-side guard is that this order
    // no longer appears in `admin.listByDate({status:"ready"})` at all once
    // delivered, so the in-game surface can never be opened against it a
    // second time in practice — this proves the mutation itself is safe if
    // ever called again).
    const repeat = await caller.admin.updateStatus({
      orderId,
      status: "delivered",
    });
    expect(repeat).toMatchObject({ success: true });
    const afterRepeat = await caller.admin.getOrder({ id: orderId });
    expect(afterRepeat?.status).toBe("delivered");
  });
});

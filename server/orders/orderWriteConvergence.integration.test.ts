import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { orders } from "../../drizzle/schema";
import { getDb } from "../db";
import { admitNativeStripePayment } from "../authority/paymentAdmission";
import {
  createNativeOrder,
  createOrReuseResidentOrder,
  reviseNativeOrder,
  transitionNativeOrderStatus,
} from "./orderLifecycleService";

const effects = vi.hoisted(() => ({ collected: vi.fn(), delivered: vi.fn() }));
vi.mock("../joystick/driverOrderEffects", () => ({
  recordDriverOrderCollected: effects.collected,
  recordDriverOrderDelivered: effects.delivered,
}));
import { updateDriverOrderStatusForMember } from "../joystick/driverOrderService";

const tenantId = `a5-${randomUUID().slice(0, 10)}`;
const fixture = () => ({
  tenantId,
  firstName: "A5",
  lastName: "Proof",
  phone: `310${Math.floor(Math.random() * 10000000)
    .toString()
    .padStart(7, "0")}`,
  address: "3545 Wilshire Blvd",
  pickupDate: "2026-10-08",
  pickupTimeWindow: "9-11",
  status: "new" as const,
  paid: false,
});
const driver = (
  orderId: number,
  status: "collected" | "delivered",
  tenant = tenantId
) =>
  updateDriverOrderStatusForMember({
    tenantId: tenant,
    orderId,
    status,
    actorUserId: null,
    actorDisplayName: "A5 proof",
  });
afterAll(async () => {
  const db = await getDb();
  if (db) await db.delete(orders).where(eq(orders.tenantId, tenantId));
});

describe("A5 real MySQL Orders convergence", () => {
  it("reuses the same resident request under concurrent creation", async () => {
    const order = { ...fixture(), bldgUserId: 98273 };
    const opts = { clientRequestId: `a5:${randomUUID()}` };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => createOrReuseResidentOrder(order, opts))
    );
    expect(new Set(results.map(result => result.orderId)).size).toBe(1);
    expect(results.filter(result => !result.reused)).toHaveLength(1);
  });
  it("collects and delivers once under races, preserving tenant and Payment boundaries", async () => {
    const id = await createNativeOrder(fixture());
    await expect(driver(id, "collected", "other-tenant")).rejects.toMatchObject(
      { code: "NOT_FOUND" }
    );
    const pickups = await Promise.all(
      Array.from({ length: 12 }, () => driver(id, "collected"))
    );
    expect(pickups.filter(result => !result.alreadyCompleted)).toHaveLength(1);
    expect(effects.collected).toHaveBeenCalledTimes(1);
    await expect(driver(id, "delivered")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      reviseNativeOrder(id, { paid: true } as never)
    ).rejects.toThrow(/Payment/);
    await admitNativeStripePayment({
      tenantId,
      orderId: id,
      paymentIntentId: `pi_a5_${randomUUID()}`,
      paidAt: new Date(),
      orderPatch: {},
    });
    const deliveries = await Promise.all(
      Array.from({ length: 12 }, () => driver(id, "delivered"))
    );
    expect(deliveries.filter(result => !result.alreadyCompleted)).toHaveLength(
      1
    );
    expect(effects.delivered).toHaveBeenCalledTimes(1);
    await driver(id, "delivered");
    expect(effects.delivered).toHaveBeenCalledTimes(1);
    const db = (await getDb())!;
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    expect(order).toMatchObject({ tenantId, paid: true, status: "delivered" });
  });
  it("does not claim a cancelled pickup completed", async () => {
    const id = await createNativeOrder({ ...fixture(), status: "cancelled" });
    await expect(
      transitionNativeOrderStatus({
        tenantId,
        orderId: id,
        status: "collected",
      })
    ).rejects.toThrow("cannot be collected");
  });
});

it("holds delivery with a legacy paid flag but no admitted Payment receipt", async () => {
  const id = await createNativeOrder({ ...fixture(), status: "ready" });
  const db = (await getDb())!;
  await db.update(orders).set({ paid: true, stripePaymentIntentId: `pi_unverified_${id}` }).where(eq(orders.id, id));
  await expect(transitionNativeOrderStatus({ orderId: id, tenantId, status: "delivered" })).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
  const [held] = await db.select().from(orders).where(eq(orders.id, id));
  expect(held.status).toBe("ready");
});

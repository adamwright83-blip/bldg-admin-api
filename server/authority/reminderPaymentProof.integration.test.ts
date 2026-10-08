import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { it, expect, vi } from "vitest";
vi.mock("../level4Offensive", () => ({ getLevel4OffensiveState: vi.fn(async () => ({ buildingPenetration: [], referralRequest: null, marketHole: { status: "stubbed_for_v1" } })) }));
import { orders, adminActionLog } from "../../drizzle/schema";
import { getDb } from "../db";
import { createNativeOrder } from "../orders/orderLifecycleService";
import { getLevel4GateState } from "../level4Gate";
import { admitNativeStripePayment } from "./paymentAdmission";
it("does not grant reminder-conversion progression from a weak paid flag", async () => {
  const db = (await getDb())!;
  const tenantId = `c2-${randomUUID().slice(0, 8)}`;
  const now = new Date("2026-10-07T18:00:00Z");
  const paidAt = new Date("2026-10-07T17:00:00Z");
  const orderId = await createNativeOrder({
    tenantId,
    firstName: "C2",
    lastName: "Proof",
    phone: "3105550151",
    address: "3545 Wilshire Blvd",
    pickupDate: "2026-10-08",
    pickupTimeWindow: "9-11",
    total: "42.00",
  });
  try {
    await db
      .update(orders)
      .set({ paid: true, paidAt, stripePaymentIntentId: "pi_c2" })
      .where(eq(orders.id, orderId));
    await db
      .insert(adminActionLog)
      .values({
        tenantId,
        actionType: "send_reminder",
        entityType: "order",
        entityId: String(orderId),
        dollarValueCents: 4200,
        status: "delivered",
        source: "manual_action",
        createdAt: new Date("2026-10-07T16:00:00Z"),
      });
    expect(
      (await getLevel4GateState(tenantId, now)).xpBreakdown.reminderConvertedXp
    ).toBe(0);
    await admitNativeStripePayment({
      tenantId,
      orderId,
      paymentIntentId: "pi_c2",
      paidAt,
      orderPatch: {},
    });
    expect(
      (await getLevel4GateState(tenantId, now)).xpBreakdown.reminderConvertedXp
    ).toBe(100);
    expect(
      (await getLevel4GateState(tenantId, now)).xpBreakdown.reminderConvertedXp
    ).toBe(100);
  } finally {
    await db
      .delete(adminActionLog)
      .where(eq(adminActionLog.tenantId, tenantId));
    await db.delete(orders).where(eq(orders.id, orderId));
  }
});
